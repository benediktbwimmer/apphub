import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { z } from 'zod';
import { Query } from 'pg';
import type { FieldDef, PoolClient, QueryResult, ResultBuilder } from 'pg';
import { getClient } from '../db/client';
import { loadServiceConfig } from '../config/serviceConfig';
import {
  authorizeSqlExecAccess,
  authorizeSqlReadAccess,
  resolveRequestActor,
  getRequestScopes
} from '../service/iam';
import {
  createDuckDbConnection,
  loadSqlContext,
  type SqlSchemaColumnInfo,
  type SqlSchemaTableInfo
} from '../sql/runtime';

const SUPPORTED_FORMATS = ['json', 'csv', 'table'] as const;
type ResponseFormat = (typeof SUPPORTED_FORMATS)[number];

const requestBodySchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.any()).optional()
});

const formatQuerySchema = z.object({
  format: z.string().optional()
});

interface QueryResultSummary {
  command: string | null;
  rowCount: number;
  fields: FieldDef[];
}

interface FormatWriter {
  readonly contentType: string;
  begin(fields: FieldDef[]): Promise<void>;
  writeRow(row: Record<string, unknown>): Promise<void>;
  end(summary: QueryResultSummary): Promise<void>;
}

type WriteChunk = (chunk: string) => Promise<void>;

export async function registerSqlRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sql/schema', async (request) => {
    await authorizeSqlReadAccess(request as FastifyRequest);
    const context = await loadSqlContext();
    const tables: SqlSchemaTableInfo[] = context.datasets.map((dataset) => ({
      name: dataset.viewName,
      description: dataset.dataset.description ?? null,
      partitionKeys: dataset.partitionKeys.length > 0 ? dataset.partitionKeys : undefined,
      columns: dataset.columns
    }));

    return {
      fetchedAt: new Date().toISOString(),
      tables,
      warnings: context.warnings
    };
  });

  app.post('/sql/read', async (request, reply) => {
    await authorizeSqlReadAccess(request as FastifyRequest);
    const { sql, params } = parseRequestBody(request);
    const format = resolveResponseFormat(request);
    assertReadOnlyStatement(sql);
    const config = loadServiceConfig();
    enforceQueryLength(sql, config.sql.maxQueryLength);

    const actor = resolveRequestActor(request as FastifyRequest);
    const scopes = getRequestScopes(request as FastifyRequest);
    const requestId = `sql-${randomUUID()}`;
    const fingerprint = fingerprintSql(sql);
    const start = process.hrtime.bigint();

    let runtime: Awaited<ReturnType<typeof createDuckDbConnection>> | null = null;
    try {
      const context = await loadSqlContext();
      runtime = await createDuckDbConnection(context);
      const execution = await executeDuckDbQuery(runtime.connection, sql, params ?? []);
      const durationMs = elapsedMs(start);
      const executionId = `duck-${randomUUID()}`;
      const warnings = dedupeWarnings(runtime.warnings);
      const columns = mapDuckDbColumns(execution.columns, execution.rows);
      const summary: QueryResultSummary = {
        command: 'SELECT',
        rowCount: execution.rows.length,
        fields: []
      };

      logSuccess(request as FastifyRequest, {
        event: 'timestore.sql.read',
        actorId: actor?.id ?? null,
        scopes,
        requestId,
        fingerprint,
        format,
        summary,
        durationMs,
        streamed: false
      });

      const baseReply = reply
        .header('x-sql-request-id', requestId)
        .header('x-sql-execution-id', executionId);

      if (warnings.length > 0) {
        baseReply.header('x-sql-warnings', JSON.stringify(warnings));
      }

      if (format === 'json') {
        const payload = {
          executionId,
          columns,
          rows: execution.rows,
          truncated: false,
          warnings,
          statistics: {
            rowCount: execution.rows.length,
            elapsedMs: durationMs
          }
        };
        baseReply.type('application/json').send(payload);
        return;
      }

      if (format === 'csv') {
        const csv = renderCsv(columns, execution.rows);
        baseReply.type('text/csv; charset=utf-8').send(csv);
        return;
      }

      const textTable = renderTable(columns, execution.rows);
      baseReply.type('text/plain; charset=utf-8').send(textTable);
    } catch (error) {
      logFailure(request as FastifyRequest, {
        event: 'timestore.sql.read_failed',
        actorId: actor?.id ?? null,
        scopes,
        requestId,
        fingerprint,
        format,
        error
      });
      throw error;
    } finally {
      await runtime?.cleanup().catch(() => {
        // ignore cleanup failures
      });
    }
  });

  app.post('/sql/exec', async (request, reply) => {
    await authorizeSqlExecAccess(request as FastifyRequest);
    const { sql, params } = parseRequestBody(request);
    const format = resolveResponseFormat(request);
    const config = loadServiceConfig();
    enforceQueryLength(sql, config.sql.maxQueryLength);

    const actor = resolveRequestActor(request as FastifyRequest);
    const scopes = getRequestScopes(request as FastifyRequest);
    const requestId = `sql-${randomUUID()}`;
    const fingerprint = fingerprintSql(sql);
    const start = process.hrtime.bigint();

    const client = await getClient();
    try {
      await setStatementTimeout(client, config.sql.statementTimeoutMs);

      const execution = await executeSqlWithStreaming({
        client,
        sql,
        params,
        reply,
        format,
        requestId,
        startMode: 'onFirstRow'
      });

      if (!execution.streamed) {
        reply.header('x-sql-request-id', requestId);
        reply.status(200).send({
          command: execution.summary.command ?? 'UNKNOWN',
          rowCount: execution.summary.rowCount
        });
      }

      logSuccess(request, {
        event: 'timestore.sql.exec',
        actorId: actor?.id ?? null,
        scopes,
        requestId,
        fingerprint,
        format,
        summary: execution.summary,
        durationMs: elapsedMs(start),
        streamed: execution.streamed
      });
    } catch (error) {
      logFailure(request, {
        event: 'timestore.sql.exec_failed',
        actorId: actor?.id ?? null,
        scopes,
        requestId,
        fingerprint,
        format,
        error
      });
      throw error;
    } finally {
      await resetStatementTimeout(client);
      client.release();
    }
  });
}

function parseRequestBody(request: FastifyRequest): { sql: string; params: unknown[] } {
  const parsed = requestBodySchema.parse(request.body ?? {});
  const params = Array.isArray(parsed.params) ? parsed.params : [];
  return {
    sql: parsed.sql,
    params
  };
}

function resolveResponseFormat(request: FastifyRequest): ResponseFormat {
  const query = formatQuerySchema.parse(request.query ?? {});
  const value = query.format?.trim().toLowerCase();
  if (!value || value.length === 0) {
    return 'json';
  }
  if ((SUPPORTED_FORMATS as readonly string[]).includes(value)) {
    return value as ResponseFormat;
  }
  const error = new Error(
    `Unsupported format "${query.format}". Supported formats: ${SUPPORTED_FORMATS.join(', ')}`
  );
  (error as Error & { statusCode?: number }).statusCode = 406;
  throw error;
}

function assertReadOnlyStatement(sql: string): void {
  if (!isSelectOnly(sql)) {
    const error = new Error('Only single SELECT statements are permitted on /sql/read');
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
}

function isSelectOnly(sql: string): boolean {
  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (containsAdditionalStatements(trimmed)) {
    return false;
  }
  const withoutComments = stripLeadingComments(trimmed).trim();
  if (withoutComments.length === 0) {
    return false;
  }
  if (/^select\b/i.test(withoutComments)) {
    return true;
  }
  if (/^with\b/i.test(withoutComments)) {
    return /\bselect\b/i.test(withoutComments);
  }
  return false;
}

function stripLeadingComments(sql: string): string {
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === '-' && next === '-') {
      const newline = sql.indexOf('\n', index + 2);
      if (newline === -1) {
        return '';
      }
      index = newline + 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      if (end === -1) {
        return '';
      }
      index = end + 2;
      continue;
    }
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    break;
  }
  return sql.slice(index);
}

function containsAdditionalStatements(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (!inSingle && !inDouble) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        index += 1;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        index += 1;
        continue;
      }
    }

    if (!inDouble && char === "'") {
      if (inSingle && next === "'") {
        index += 1;
      } else {
        inSingle = !inSingle;
      }
      continue;
    }

    if (!inSingle && char === '"') {
      if (inDouble && next === '"') {
        index += 1;
      } else {
        inDouble = !inDouble;
      }
      continue;
    }

    if (!inSingle && !inDouble && char === ';') {
      const rest = sql.slice(index + 1);
      if (/\S/.test(rest)) {
        return true;
      }
      return false;
    }
  }

  return false;
}

function fingerprintSql(sql: string): string {
  return createHash('sha256').update(sql.trim()).digest('hex').slice(0, 16);
}

function enforceQueryLength(sql: string, maxLength: number): void {
  if (sql.length > maxLength) {
    const error = new Error(`SQL statement exceeds maximum length of ${maxLength} characters`);
    (error as Error & { statusCode?: number }).statusCode = 413;
    throw error;
  }
}

async function setStatementTimeout(client: PoolClient, timeoutMs: number): Promise<void> {
  const value = Number.isFinite(timeoutMs) ? Math.max(0, Math.floor(timeoutMs)) : 0;
  await client.query(`SET statement_timeout = ${value}`);
}

async function resetStatementTimeout(client: PoolClient): Promise<void> {
  try {
    await client.query('SET statement_timeout TO DEFAULT');
  } catch {
    // ignore reset failures, connection will be recycled by pool
  }
}

interface StreamingOptions {
  client: PoolClient;
  sql: string;
  params: unknown[];
  reply: FastifyReply;
  format: ResponseFormat;
  requestId: string;
  startMode: 'auto' | 'onFirstRow';
}

async function executeSqlWithStreaming(options: StreamingOptions): Promise<{
  summary: QueryResultSummary;
  streamed: boolean;
}> {
  const { client, sql, params, reply, format, requestId, startMode } = options;
  const stream = new PassThrough({ encoding: 'utf8' });
  let streamed = false;
  const writer = createFormatWriter(format, async (chunk) => {
    if (chunk.length === 0) {
      return;
    }
    if (!stream.write(chunk)) {
      await once(stream, 'drain');
    }
  });

  const result = await runStreamingQuery({
    client,
    sql,
    params,
    stream,
    writer,
    startMode,
    markStreamed: () => {
      if (!streamed) {
        streamed = true;
        reply.header('x-sql-request-id', requestId);
        reply.type(writer.contentType);
        reply.send(stream);
      }
    }
  });

  if (!streamed) {
    stream.destroy();
  }

  return {
    summary: result.summary,
    streamed
  };
}

interface RunStreamingQueryOptions {
  client: PoolClient;
  sql: string;
  params: unknown[];
  stream: PassThrough;
  writer: FormatWriter;
  startMode: 'auto' | 'onFirstRow';
  markStreamed: () => void;
}

async function runStreamingQuery(options: RunStreamingQueryOptions): Promise<{
  summary: QueryResultSummary;
}> {
  const { client, sql, params, stream, writer, startMode, markStreamed } = options;

  const query = client.query(new Query({ text: sql, values: params as unknown[] as any[] }));
  const rowQueue: Array<{ row: Record<string, unknown>; fields: FieldDef[] }> = [];
  let processing = false;
  let finalized = false;
  let beginCalled = false;
  let rowsSeen = 0;
  let endResult: QueryResult<Record<string, unknown>> | null = null;
  let lastFields: FieldDef[] = [];
  let endReceived = false;
  let streamStarted = false;

  const ensureStreamStarted = () => {
    if (!streamStarted) {
      streamStarted = true;
      markStreamed();
    }
  };

  if (startMode === 'auto') {
    ensureStreamStarted();
  }

  const summary = await new Promise<QueryResultSummary>((resolve, reject) => {
    const finalizeSuccess = async () => {
      if (finalized) {
        return;
      }
      finalized = true;
      try {
        const result = endResult ?? {
          command: null,
          rowCount: rowsSeen,
          fields: lastFields
        };
        const finalFields = result.fields ?? lastFields ?? [];
        if (!beginCalled) {
          await writer.begin(finalFields);
          beginCalled = true;
        }
        await writer.end({
          command: result.command ?? null,
          rowCount: typeof result.rowCount === 'number' ? result.rowCount : rowsSeen,
          fields: finalFields
        });
        stream.end();
        resolve({
          command: result.command ?? null,
          rowCount: typeof result.rowCount === 'number' ? result.rowCount : rowsSeen,
          fields: finalFields
        });
      } catch (error) {
        stream.destroy(error as Error);
        reject(error);
      }
    };

    const finalizeWithoutStreaming = () => {
      if (finalized) {
        return;
      }
      finalized = true;
      const result = endResult ?? {
        command: null,
        rowCount: rowsSeen,
        fields: lastFields
      };
      resolve({
        command: result.command ?? null,
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : rowsSeen,
        fields: result.fields ?? []
      });
    };

    const processQueue = async () => {
      if (processing || finalized) {
        return;
      }
      processing = true;
      try {
        while (rowQueue.length > 0) {
          const item = rowQueue.shift()!;
          if (startMode === 'onFirstRow') {
            ensureStreamStarted();
          }
          if (!beginCalled) {
            await writer.begin(item.fields);
            beginCalled = true;
          }
          await writer.writeRow(item.row);
          rowsSeen += 1;
        }

        if (endReceived && rowQueue.length === 0) {
          const resultFields = endResult?.fields ?? lastFields ?? [];
          const shouldStream = streamStarted || rowsSeen > 0 || startMode === 'auto' || resultFields.length > 0;
          if (!shouldStream) {
            finalizeWithoutStreaming();
            return;
          }
          ensureStreamStarted();
          if (!beginCalled && resultFields.length > 0) {
            await writer.begin(resultFields);
            beginCalled = true;
          }
          await finalizeSuccess();
        }
      } catch (error) {
        if (!finalized) {
          finalized = true;
          stream.destroy(error as Error);
          reject(error);
        }
      } finally {
        processing = false;
      }
    };

    query.on('row', (row: Record<string, unknown>, result?: ResultBuilder<Record<string, unknown>>) => {
      const fields = result?.fields ?? lastFields;
      rowQueue.push({ row, fields });
      lastFields = fields;
      void processQueue();
    });

    query.on('end', (result: ResultBuilder<Record<string, unknown>>) => {
      endResult = result;
      endReceived = true;
      void processQueue();
    });

    query.on('error', (error: Error) => {
      if (finalized) {
        return;
      }
      finalized = true;
      stream.destroy(error as Error);
      reject(error);
    });
  });

  return { summary };
}

interface DuckDbColumnMeta {
  name: string;
  type?: {
    sql_type?: string;
    alias?: string;
    id?: string;
  } | string | null;
}

interface DuckDbExecutionResult {
  rows: Array<Record<string, unknown>>;
  columns: DuckDbColumnMeta[];
}

async function executeDuckDbQuery(connection: any, sql: string, params: unknown[]): Promise<DuckDbExecutionResult> {
  const statement = connection.prepare(sql);
  const columnInfo: DuckDbColumnMeta[] = typeof statement.columns === 'function' ? statement.columns() ?? [] : [];
  try {
    const rows = await statementAll(statement, params);
    await finalizeStatement(statement);
    return {
      rows,
      columns: columnInfo
    } satisfies DuckDbExecutionResult;
  } catch (error) {
    try {
      await finalizeStatement(statement);
    } catch {
      // ignore finalize failures during error handling
    }
    throw error;
  }
}

function statementAll(statement: any, params: unknown[]): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    statement.all(...params, (err: Error | null, rows?: Array<Record<string, unknown>>) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows ?? []);
      }
    });
  });
}

function finalizeStatement(statement: any): Promise<void> {
  if (typeof statement.finalize !== 'function') {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    statement.finalize((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function mapDuckDbColumns(columns: DuckDbColumnMeta[], rows: Array<Record<string, unknown>>): SqlSchemaColumnInfo[] {
  if (columns.length > 0) {
    return columns.map((column) => ({
      name: column.name,
      type: normalizeDuckDbType(column.type),
      nullable: undefined,
      description: null
    }));
  }

  if (rows.length === 0) {
    return [];
  }

  const names = Object.keys(rows[0] ?? {});
  return names.map((name) => ({
    name,
    type: inferTypeFromRows(rows, name),
    nullable: undefined,
    description: null
  }));
}

function normalizeDuckDbType(type: DuckDbColumnMeta['type']): string {
  if (!type) {
    return 'UNKNOWN';
  }
  if (typeof type === 'string') {
    return type.toUpperCase();
  }
  const candidate = type.sql_type ?? type.alias ?? type.id;
  return typeof candidate === 'string' ? candidate.toUpperCase() : 'UNKNOWN';
}

function inferTypeFromRows(rows: Array<Record<string, unknown>>, columnName: string): string {
  for (const row of rows) {
    const value = row[columnName];
    if (value === null || value === undefined) {
      continue;
    }
    if (value instanceof Date) {
      return 'TIMESTAMP';
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE';
    }
    if (typeof value === 'bigint') {
      return 'BIGINT';
    }
    if (typeof value === 'boolean') {
      return 'BOOLEAN';
    }
    if (typeof value === 'object') {
      return 'JSON';
    }
    return 'VARCHAR';
  }
  return 'UNKNOWN';
}

function renderCsv(columns: SqlSchemaColumnInfo[], rows: Array<Record<string, unknown>>): string {
  const effectiveColumns = columns.length > 0
    ? columns
    : Object.keys(rows[0] ?? {}).map((name) => ({ name, type: undefined }));

  if (effectiveColumns.length === 0) {
    return '';
  }

  const header = effectiveColumns.map((column) => escapeCsv(column.name)).join(',');
  const lines = rows.map((row) =>
    effectiveColumns
      .map((column) => escapeCsv(formatCell(row[column.name])))
      .join(',')
  );
  return [header, ...lines].join('\n');
}

function renderTable(columns: SqlSchemaColumnInfo[], rows: Array<Record<string, unknown>>): string {
  const effectiveColumns = columns.length > 0
    ? columns
    : Object.keys(rows[0] ?? {}).map((name) => ({ name, type: undefined }));

  if (effectiveColumns.length === 0) {
    return '(0 rows)\n';
  }

  const names = effectiveColumns.map((column) => column.name);
  const widths = names.map((name) =>
    Math.max(name.length, ...rows.map((row) => formatTableCell(row[name]).length))
  );

  const header = names
    .map((name, index) => padCell(name, widths[index]))
    .join(' | ');
  const separator = widths
    .map((width) => repeatChar('-', width))
    .join('-+-');
  const body = rows.map((row) =>
    names.map((name, index) => padCell(formatTableCell(row[name]), widths[index])).join(' | ')
  );

  const footer = `(${rows.length} row${rows.length === 1 ? '' : 's'})`;
  return [header, separator, ...body, footer].join('\n');
}

function padCell(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return `${value}${' '.repeat(width - value.length)}`;
}

function dedupeWarnings(warnings: string[]): string[] {
  const unique = new Set(
    warnings
      .map((warning) => warning?.toString().trim())
      .filter((warning): warning is string => Boolean(warning) && warning.length > 0)
  );
  return Array.from(unique);
}

function createFormatWriter(format: ResponseFormat, write: WriteChunk): FormatWriter {
  switch (format) {
    case 'json':
      return new JsonFormatWriter(write);
    case 'csv':
      return new CsvFormatWriter(write);
    case 'table':
      return new TableFormatWriter(write);
    default:
      return new JsonFormatWriter(write);
  }
}

class JsonFormatWriter implements FormatWriter {
  public readonly contentType = 'application/json';
  private firstRow = true;

  constructor(private readonly write: WriteChunk) {}

  async begin(): Promise<void> {
    await this.write('[');
  }

  async writeRow(row: Record<string, unknown>): Promise<void> {
    const prefix = this.firstRow ? '' : ',';
    this.firstRow = false;
    await this.write(`${prefix}${JSON.stringify(row)}`);
  }

  async end(): Promise<void> {
    await this.write(']');
  }
}

class CsvFormatWriter implements FormatWriter {
  public readonly contentType = 'text/csv; charset=utf-8';
  private fields: FieldDef[] = [];
  private headerWritten = false;

  constructor(private readonly write: WriteChunk) {}

  async begin(fields: FieldDef[]): Promise<void> {
    this.fields = fields;
    if (fields.length === 0) {
      this.headerWritten = true;
      return;
    }
    const header = fields.map((field) => escapeCsv(field.name)).join(',');
    await this.write(`${header}\n`);
    this.headerWritten = true;
  }

  async writeRow(row: Record<string, unknown>): Promise<void> {
    if (!this.headerWritten) {
      await this.begin(this.fields);
    }
    const line = this.fields
      .map((field) => escapeCsv(formatCell(row[field.name])))
      .join(',');
    await this.write(`${line}\n`);
  }

  async end(): Promise<void> {
    if (!this.headerWritten && this.fields.length > 0) {
      await this.begin(this.fields);
    }
  }
}

class TableFormatWriter implements FormatWriter {
  public readonly contentType = 'text/plain; charset=utf-8';
  private fields: FieldDef[] = [];
  private headerWritten = false;
  private rowsWritten = 0;

  constructor(private readonly write: WriteChunk) {}

  async begin(fields: FieldDef[]): Promise<void> {
    this.fields = fields;
    if (fields.length === 0) {
      this.headerWritten = true;
      return;
    }
    const header = fields.map((field) => field.name).join('\t');
    const separator = fields.map((field) => repeatChar('-', Math.max(field.name.length, 3))).join('\t');
    await this.write(`${header}\n`);
    await this.write(`${separator}\n`);
    this.headerWritten = true;
  }

  async writeRow(row: Record<string, unknown>): Promise<void> {
    if (!this.headerWritten) {
      await this.begin(this.fields);
    }
    const line = this.fields.map((field) => formatTableCell(row[field.name])).join('\t');
    this.rowsWritten += 1;
    await this.write(`${line}\n`);
  }

  async end(summary: QueryResultSummary): Promise<void> {
    if (!this.headerWritten) {
      await this.begin(this.fields);
    }
    const totalRows = summary.rowCount ?? this.rowsWritten;
    await this.write(`(${totalRows} row${totalRows === 1 ? '' : 's'})\n`);
  }
}

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `\\x${value.toString('hex')}`;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatTableCell(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  return formatCell(value);
}

function repeatChar(char: string, count: number): string {
  return char.repeat(Math.max(count, 1));
}

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

interface LogSuccessParams {
  event: string;
  actorId: string | null;
  scopes: string[];
  requestId: string;
  fingerprint: string;
  format: ResponseFormat;
  summary: QueryResultSummary;
  durationMs: number;
  streamed?: boolean;
}

interface LogFailureParams {
  event: string;
  actorId: string | null;
  scopes: string[];
  requestId: string;
  fingerprint: string;
  format: ResponseFormat;
  error: unknown;
}

function logSuccess(request: FastifyRequest, params: LogSuccessParams): void {
  request.log.info(
    {
      event: params.event,
      requestId: params.requestId,
      actorId: params.actorId,
      scopes: params.scopes,
      fingerprint: params.fingerprint,
      format: params.format,
      rowCount: params.summary.rowCount,
      command: params.summary.command,
      durationMs: params.durationMs,
      streamed: params.streamed ?? true
    },
    'sql query succeeded'
  );
}

function logFailure(request: FastifyRequest, params: LogFailureParams): void {
  request.log.error(
    {
      event: params.event,
      requestId: params.requestId,
      actorId: params.actorId,
      scopes: params.scopes,
      fingerprint: params.fingerprint,
      format: params.format,
      error: params.error instanceof Error ? params.error.message : String(params.error)
    },
    'sql query failed'
  );
}
