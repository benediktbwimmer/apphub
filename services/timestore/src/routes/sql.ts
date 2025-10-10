import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { z } from 'zod';
import { Query } from 'pg';
import type { FieldDef, PoolClient, QueryResult, ResultBuilder } from 'pg';
import { getClient } from '../db/client';
import { loadServiceConfig } from '../config/serviceConfig';
import { schemaRef } from '../openapi/definitions';
import { errorResponse, jsonResponse } from '../openapi/utils';
import {
  authorizeAdminAccess,
  authorizeSqlExecAccess,
  authorizeSqlReadAccess,
  resolveRequestActor,
  getRequestScopes
} from '../service/iam';
import {
  deleteSavedSqlQuery,
  getSavedSqlQueryById,
  listSavedSqlQueries,
  upsertSavedSqlQuery
} from '../db/sqlSavedQueries';
import type { SavedSqlQueryRecord } from '../db/sqlSavedQueries';
import {
  listDatasets,
  getLatestPublishedManifest,
  getSchemaVersionById,
  getDatasetBySlug,
  type DatasetRecord
} from '../db/metadata';
import { deriveTableName, quoteIdentifier as quoteClickHouseIdentifier } from '../clickhouse/util';
import { extractFieldDefinitions, normalizeFieldDefinitions } from '../schema/compatibility';
import { getClickHouseClient } from '../clickhouse/client';

const SUPPORTED_FORMATS = ['json', 'csv', 'table'] as const;
type ResponseFormat = (typeof SUPPORTED_FORMATS)[number];

const requestBodySchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.any()).optional()
});

const CLICKHOUSE_PROXY_DEFAULT_MAX_ROWS = 10_000;
const CLICKHOUSE_PROXY_MAX_ROWS_LIMIT = 100_000;

const clickHouseProxyRequestSchema = z.object({
  sql: z.string().min(1),
  mode: z.enum(['auto', 'query', 'command']).default('auto'),
  maxRows: z
    .number()
    .int()
    .positive()
    .max(CLICKHOUSE_PROXY_MAX_ROWS_LIMIT)
    .default(CLICKHOUSE_PROXY_DEFAULT_MAX_ROWS)
});

const formatQuerySchema = z.object({
  format: z.string().optional()
});

const savedQueryParamsSchema = z.object({
  id: z.string().min(1)
});

const savedQueryBodySchema = z.object({
  statement: z.string().min(1),
  label: z.union([z.string(), z.null()]).optional(),
  stats: z
    .object({
      rowCount: z.number().int().nonnegative().optional(),
      elapsedMs: z.number().int().nonnegative().optional()
    })
    .optional()
});

interface QueryResultSummary {
  command: string | null;
  rowCount: number;
  fields: FieldDef[];
}

interface SqlSchemaColumnInfo {
  name: string;
  type: string | undefined;
  nullable?: boolean;
  description?: string | null;
}

interface SqlSchemaTableInfo {
  name: string;
  description: string | null;
  partitionKeys?: string[];
  columns: SqlSchemaColumnInfo[];
}

interface FormatWriter {
  readonly contentType: string;
  begin(fields: FieldDef[]): Promise<void>;
  writeRow(row: Record<string, unknown>): Promise<void>;
  end(summary: QueryResultSummary): Promise<void>;
}

type WriteChunk = (chunk: string) => Promise<void>;

export async function registerSqlRoutes(app: FastifyInstance): Promise<void> {
  const jsonParser = (request: FastifyRequest, body: string, done: (err: Error | null, body?: unknown) => void) => {
    if (!body || body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (error) {
      const parseError = error instanceof Error ? error : new Error('Invalid JSON payload');
      (parseError as Error & { statusCode?: number }).statusCode = 400;
      done(parseError);
    }
  };

  try {
    app.removeContentTypeParser('application/json');
  } catch {
    // Ignore missing parser removal failures.
  }
  app.addContentTypeParser(/^application\/json($|;)/, { parseAs: 'string' }, jsonParser);

  app.get(
    '/sql/schema',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Describe SQL schema',
        description: 'Returns the current logical schema exposed to the SQL runtime.',
        response: {
          200: jsonResponse('SqlSchemaResponse', 'SQL schema snapshot for available datasets.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to inspect SQL metadata.'),
          500: errorResponse('Failed to load SQL schema information.')
        }
      }
    },
    async (request) => {
      await authorizeSqlReadAccess(request as FastifyRequest);
      const tables = await loadSqlSchemaTables();
      return {
        fetchedAt: new Date().toISOString(),
        tables,
        warnings: [] as string[]
      };
    }
  );

  app.post(
    '/sql/read',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Execute read-only SQL query',
        description:
          'Runs a read-only SELECT statement against the SQL runtime and returns the result set in the requested format.',
        body: schemaRef('SqlQueryRequest'),
        response: {
          200: {
            description: 'Query executed successfully.',
            content: {
              'application/json': {
                schema: schemaRef('SqlReadResponse')
              },
              'text/csv': {
                schema: {
                  type: 'string',
                  description: 'Result set rendered as CSV.'
                }
              },
              'text/plain': {
                schema: {
                  type: 'string',
                  description: 'Result set rendered as an ASCII table.'
                }
              }
            }
          },
          400: errorResponse('Invalid SQL read request.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to run SQL queries.'),
          406: errorResponse('Requested response format is not supported.'),
          500: errorResponse('SQL read execution failed.')
        }
      }
    },
    async (request, reply) => {
      await authorizeSqlReadAccess(request as FastifyRequest);
      const { sql, params } = parseRequestBody(request);
      const format = resolveResponseFormat(request);
      assertReadOnlyStatement(sql);
      const config = loadServiceConfig();
      enforceQueryLength(sql, config.sql.maxQueryLength);

      if (params.length > 0) {
        const error = new Error('Parameterized SQL is not yet supported for ClickHouse queries.');
        (error as Error & { statusCode?: number }).statusCode = 400;
        throw error;
      }

      const actor = resolveRequestActor(request as FastifyRequest);
      const scopes = getRequestScopes(request as FastifyRequest);
      const requestId = `sql-${randomUUID()}`;
      const rewrittenSql = await rewriteDatasetTableReferences(sql);
      const fingerprint = fingerprintSql(rewrittenSql);
      const start = process.hrtime.bigint();

      try {
        const execution = await executeClickHouseSelect(rewrittenSql);
        const durationMs = elapsedMs(start);
        const executionId = `ch-${randomUUID()}`;
        const fields = createFieldDefs(execution.columns);
        const summary: QueryResultSummary = {
          command: 'SELECT',
          rowCount: execution.rows.length,
          fields
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

        if (format === 'json') {
          const payload = {
            executionId,
            columns: execution.columns,
            rows: execution.rows,
            truncated: false,
            warnings: [] as string[],
            statistics: {
              rowCount: execution.rows.length,
              elapsedMs: execution.statistics.elapsedMs ?? durationMs
            }
          };
          baseReply.type('application/json').send(payload);
          return;
        }

        if (format === 'csv') {
          const csv = renderCsv(execution.columns, execution.rows);
          baseReply.type('text/csv; charset=utf-8').send(csv);
          return;
        }

        const textTable = renderTable(execution.columns, execution.rows);
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
      }
    }
  );

  app.post(
    '/sql/admin/clickhouse',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Execute raw ClickHouse statement',
        description:
          'Runs an arbitrary ClickHouse statement against the configured ClickHouse backend without dataset rewrites.',
        body: schemaRef('ClickHouseProxyRequest'),
        response: {
          200: jsonResponse('ClickHouseProxyResponse', 'Statement executed successfully.'),
          400: errorResponse('Invalid ClickHouse proxy request.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to execute ClickHouse statements.'),
          500: errorResponse('ClickHouse proxy execution failed.')
        }
      }
    },
    async (request, reply) => {
      await authorizeAdminAccess(request as FastifyRequest);
      authorizeSqlExecAccess(request as FastifyRequest);
      const body = clickHouseProxyRequestSchema.parse(request.body ?? {});
      const sql = body.sql.trim();
      if (sql.length === 0) {
        const error = new Error('SQL statement is required.');
        (error as Error & { statusCode?: number }).statusCode = 400;
        throw error;
      }

      const config = loadServiceConfig();
      enforceQueryLength(sql, config.sql.maxQueryLength);

      const actor = resolveRequestActor(request as FastifyRequest);
      const scopes = getRequestScopes(request as FastifyRequest);
      const requestId = `sql-proxy-${randomUUID()}`;
      const executionId = `ch-proxy-${randomUUID()}`;
      const fingerprint = fingerprintSql(sql);
      const format: ResponseFormat = 'json';
      const command = extractStatementCommand(sql);
      const mode = resolveProxyMode(body.mode, sql);
      const start = process.hrtime.bigint();

      const baseReply = reply
        .header('x-sql-request-id', requestId)
        .header('x-sql-execution-id', executionId)
        .type('application/json');

      try {
        if (mode === 'command') {
          const client = getClickHouseClient(config.clickhouse);
          await client.command({ query: sql });
          const durationMs = elapsedMs(start);
          const summary: QueryResultSummary = {
            command,
            rowCount: 0,
            fields: []
          };

          logSuccess(request as FastifyRequest, {
            event: 'timestore.sql.clickhouse',
            actorId: actor?.id ?? null,
            scopes,
            requestId,
            fingerprint,
            format,
            summary,
            durationMs,
            streamed: false
          });

          baseReply.send({
            executionId,
            mode,
            command,
            columns: [] as SqlSchemaColumnInfo[],
            rows: [] as Array<Record<string, unknown>>,
            truncated: false,
            statistics: {
              elapsedMs: durationMs,
              rowCount: 0,
              raw: null
            },
            warnings: [] as string[]
          });
          return;
        }

        const execution = await executeClickHouseSelect(sql);
        const durationMs = elapsedMs(start);
        const totalRows = execution.rows.length;
        const truncated = totalRows > body.maxRows;
        const limitedRows = truncated ? execution.rows.slice(0, body.maxRows) : execution.rows;
        const summary: QueryResultSummary = {
          command,
          rowCount: limitedRows.length,
          fields: createFieldDefs(execution.columns)
        };

        logSuccess(request as FastifyRequest, {
          event: 'timestore.sql.clickhouse',
          actorId: actor?.id ?? null,
          scopes,
          requestId,
          fingerprint,
          format,
          summary,
          durationMs,
          streamed: false
        });

        const warnings: string[] = [];
        if (truncated) {
          warnings.push(`Result set truncated to ${body.maxRows} rows.`);
        }

        baseReply.send({
          executionId,
          mode,
          command,
          columns: execution.columns,
          rows: limitedRows,
          truncated,
          statistics: {
            elapsedMs: execution.statistics.elapsedMs ?? durationMs,
            rowCount: totalRows,
            raw: execution.statistics.raw
          },
          warnings
        });
      } catch (error) {
        logFailure(request as FastifyRequest, {
          event: 'timestore.sql.clickhouse_failed',
          actorId: actor?.id ?? null,
          scopes,
          requestId,
          fingerprint,
          format,
          error
        });
        throw error;
      }
    }
  );

  app.get(
    '/sql/saved',
    {
      schema: {
        tags: ['SQL'],
        summary: 'List saved SQL queries',
        response: {
          200: jsonResponse('SqlSavedQueryListResponse', 'Saved SQL queries accessible to the caller.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to manage saved SQL queries.'),
          500: errorResponse('Failed to load saved queries.')
        }
      }
    },
    async (request) => {
      await authorizeSqlReadAccess(request as FastifyRequest);
      const records = await listSavedSqlQueries();
      return {
        savedQueries: records.map(mapSavedSqlQuery)
      };
    }
  );

  app.get(
    '/sql/saved/:id',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Get saved SQL query',
        params: schemaRef('SqlSavedQueryParams'),
        response: {
          200: jsonResponse('SqlSavedQueryResponse', 'Saved SQL query definition.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to access saved SQL queries.'),
          404: errorResponse('Saved SQL query not found.'),
          500: errorResponse('Failed to load saved SQL query.')
        }
      }
    },
    async (request, reply) => {
      await authorizeSqlReadAccess(request as FastifyRequest);
      const params = savedQueryParamsSchema.parse(request.params ?? {});
      const record = await getSavedSqlQueryById(params.id);
      if (!record) {
        reply.status(404);
        return {
          error: `Saved query ${params.id} not found`
        };
      }
      return {
        savedQuery: mapSavedSqlQuery(record)
      };
    }
  );

  app.put(
    '/sql/saved/:id',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Create or update saved SQL query',
        params: schemaRef('SqlSavedQueryParams'),
        body: schemaRef('SqlSavedQueryUpsertRequest'),
        response: {
          200: jsonResponse('SqlSavedQueryResponse', 'Saved SQL query persisted successfully.'),
          400: errorResponse('Invalid saved query payload.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to manage saved SQL queries.'),
          500: errorResponse('Failed to persist saved SQL query.')
        }
      }
    },
    async (request) => {
      await authorizeSqlReadAccess(request as FastifyRequest);
      const params = savedQueryParamsSchema.parse(request.params ?? {});
      const body = savedQueryBodySchema.parse(request.body ?? {});
      const actor = resolveRequestActor(request as FastifyRequest);
      const saved = await upsertSavedSqlQuery({
        id: params.id,
        statement: body.statement,
        label: normalizeLabel(body.label),
        stats: body.stats,
        createdBy: actor?.id ?? null
      });
      return {
        savedQuery: mapSavedSqlQuery(saved)
      };
    }
  );

  app.delete(
    '/sql/saved/:id',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Delete saved SQL query',
        params: schemaRef('SqlSavedQueryParams'),
        response: {
          204: {
            description: 'Saved SQL query deleted successfully.'
          },
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to manage saved SQL queries.'),
          404: errorResponse('Saved SQL query not found.'),
          500: errorResponse('Failed to delete saved SQL query.')
        }
      }
    },
    async (request, reply) => {
      await authorizeSqlReadAccess(request as FastifyRequest);
      const params = savedQueryParamsSchema.parse(request.params ?? {});
      const removed = await deleteSavedSqlQuery(params.id);
      if (!removed) {
        reply.status(404);
        return {
          error: `Saved query ${params.id} not found`
        };
      }
      return reply.status(204).send();
    }
  );

  app.post(
    '/sql/exec',
    {
      schema: {
        tags: ['SQL'],
        summary: 'Execute SQL statement',
        description:
          'Executes a SQL statement with optional streaming responses for large result sets.',
        body: schemaRef('SqlQueryRequest'),
        response: {
          200: {
            description: 'Statement executed successfully.',
            content: {
              'application/json': {
                schema: schemaRef('SqlExecResponse')
              },
              'text/csv': {
                schema: {
                  type: 'string',
                  description: 'Row stream encoded as CSV.'
                }
              },
              'text/plain': {
                schema: {
                  type: 'string',
                  description: 'Row stream encoded as plain text.'
                }
              }
            }
          },
          400: errorResponse('Invalid SQL execution request.'),
          401: errorResponse('Authentication is required.'),
          403: errorResponse('Caller lacks permission to execute SQL statements.'),
          406: errorResponse('Requested response format is not supported.'),
          500: errorResponse('SQL execution failed.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );
}

function mapSavedSqlQuery(record: SavedSqlQueryRecord) {
  return {
    id: record.id,
    statement: record.statement,
    label: record.label,
    stats: record.stats ?? undefined,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function normalizeLabel(label: string | null | undefined): string | null {
  if (label === null || label === undefined) {
    return null;
  }
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
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

type ClickHouseProxyMode = 'query' | 'command';

const CLICKHOUSE_QUERY_KEYWORDS = new Set([
  'select',
  'with',
  'show',
  'describe',
  'desc',
  'exists',
  'explain',
  'system',
  'values'
]);

function resolveProxyMode(mode: 'auto' | 'query' | 'command', sql: string): ClickHouseProxyMode {
  if (mode === 'query' || mode === 'command') {
    return mode;
  }
  return classifyProxyMode(sql);
}

function classifyProxyMode(sql: string): ClickHouseProxyMode {
  const normalized = stripLeadingComments(sql).trim();
  if (normalized.length === 0) {
    return 'command';
  }
  const match = normalized.match(/^([A-Za-z]+)/);
  if (!match) {
    return 'command';
  }
  if (CLICKHOUSE_QUERY_KEYWORDS.has(match[1].toLowerCase())) {
    return 'query';
  }
  return 'command';
}

function extractStatementCommand(sql: string): string {
  const normalized = stripLeadingComments(sql).trim();
  if (normalized.length === 0) {
    return 'UNKNOWN';
  }
  const tokens = normalized.split(/\s+/);
  if (tokens.length === 0) {
    return 'UNKNOWN';
  }
  const first = tokens[0].toUpperCase();
  const second = tokens.length > 1 ? tokens[1].toUpperCase() : null;
  if (['CREATE', 'DROP', 'ALTER', 'INSERT', 'OPTIMIZE', 'TRUNCATE'].includes(first) && second) {
    return `${first} ${second}`;
  }
  if (first === 'SYSTEM' && second) {
    return `${first} ${second}`;
  }
  return first;
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

async function executeClickHouseSelect(
  sql: string
): Promise<{
  rows: Array<Record<string, unknown>>;
  columns: SqlSchemaColumnInfo[];
  statistics: {
    elapsedMs: number | null;
    raw: {
      rowsRead: number | null;
      bytesRead: number | null;
      appliedLimit: number | null;
    } | null;
  };
}> {
  const config = loadServiceConfig();
  const client = getClickHouseClient(config.clickhouse);
  const result = await client.query({ query: sql, format: 'JSON' });
  const payload = (await result.json()) as {
    data?: Array<Record<string, unknown>>;
    meta?: Array<{ name: string; type: string }>;
    statistics?: { elapsed?: number; rows_read?: number; bytes_read?: number; applied_limit?: number };
  };

  const rawRows = payload?.data ?? [];
  const rows = rawRows.map(normalizeSqlRow);
  const columns = payload?.meta
    ? payload.meta
        .filter((entry) => !isInternalColumn(entry.name))
        .map((entry) => ({
          name: entry.name,
          type: mapClickHouseTypeToSqlType(entry.type),
          nullable: entry.type.includes('Nullable'),
          description: null
        }))
    : deriveResultColumns(rows);

  return {
    rows,
    columns,
    statistics: {
      elapsedMs: payload?.statistics?.elapsed !== undefined ? payload.statistics.elapsed * 1_000 : null,
      raw:
        payload?.statistics &&
        (Number.isFinite(payload.statistics.rows_read ?? NaN) ||
          Number.isFinite(payload.statistics.bytes_read ?? NaN) ||
          Number.isFinite(payload.statistics.applied_limit ?? NaN))
          ? {
              rowsRead: Number.isFinite(payload.statistics.rows_read ?? NaN)
                ? Number(payload.statistics.rows_read)
                : null,
              bytesRead: Number.isFinite(payload.statistics.bytes_read ?? NaN)
                ? Number(payload.statistics.bytes_read)
                : null,
              appliedLimit: Number.isFinite(payload.statistics.applied_limit ?? NaN)
                ? Number(payload.statistics.applied_limit)
                : null
            }
          : null
    }
  };
}

const DATASET_REFERENCE_REGEX =
  /\b(FROM|JOIN)\s+(?:timestore\.)?["`]([A-Za-z0-9_.:\-]+)["`](\s+(?:AS\s+)?(?!ON\b|USING\b)[A-Za-z0-9_"`]+)?/gi;
const DATASET_REFERENCE_UNQUOTED_REGEX =
  /\b(FROM|JOIN)\s+(?:timestore\.)?([A-Za-z0-9_]+)(\s+(?:AS\s+)?(?!ON\b|USING\b)[A-Za-z0-9_"`]+)?/gi;
const DATASET_TABLE_CACHE = new Map<string, string | null>();
const DATASET_ALIAS_REGEX =
  /\b(FROM|JOIN)\s+(?:timestore\.)?["`]?(?<slug>[A-Za-z0-9_.:\-]+)["`]?(?:\s+(?:AS\s+)?(?<alias>[A-Za-z0-9_"`]+))?/gi;

async function rewriteDatasetTableReferences(sql: string): Promise<string> {
  let rewritten = sql;

  const quotedMatches = Array.from(sql.matchAll(DATASET_REFERENCE_REGEX));
  const unquotedMatches = Array.from(sql.matchAll(DATASET_REFERENCE_UNQUOTED_REGEX)).filter((match) => {
    const quoted = quotedMatches.some((existing) => existing.index === match.index);
    return !quoted && match[2] && /^[A-Za-z0-9_]+$/.test(match[2]);
  });

  const matches = [...quotedMatches, ...unquotedMatches];
  if (matches.length === 0) {
    return sql;
  }

  const resolvedIdentifiers = new Map<string, string | null>();
  for (const match of matches) {
    const slug = match[2];
    if (!resolvedIdentifiers.has(slug)) {
      const identifier = await resolveDatasetTableIdentifier(slug);
      resolvedIdentifiers.set(slug, identifier);
    }
  }

  if (Array.from(resolvedIdentifiers.values()).every((value) => value === null)) {
    return sql;
  }

  const aliasMap = buildDatasetAliasMap(sql, resolvedIdentifiers);

  const applyReplacement = (inputSql: string, regex: RegExp) =>
    inputSql.replace(regex, (full, keyword, slug, alias = '') => {
      const identifier = resolvedIdentifiers.get(slug);
      if (!identifier) {
        return full;
      }
      return `${keyword} ${identifier}${alias ?? ''}`;
    });

  rewritten = applyReplacement(rewritten, DATASET_REFERENCE_REGEX);
  rewritten = applyReplacement(rewritten, DATASET_REFERENCE_UNQUOTED_REGEX);

  if (aliasMap.size > 0) {
    aliasMap.forEach((aliasSet, slug) => {
      const identifier = resolvedIdentifiers.get(slug);
      if (!identifier) {
        return;
      }
      aliasSet.forEach((alias) => {
        const bareAlias = alias.replace(/["`]/g, '');
        const regex = new RegExp(`\\b${bareAlias.replace(/[-\\/^$*+?.()|[\\]{}]/g, '\\\\$&')}\\.`, 'g');
        rewritten = rewritten.replace(regex, `${identifier}.`);
      });
    });
  }

  return rewritten;
}

function buildDatasetAliasMap(
  sql: string,
  identifiers: Map<string, string | null>
): Map<string, Set<string>> {
  const aliasMap = new Map<string, Set<string>>();
  const matches = sql.matchAll(DATASET_ALIAS_REGEX);
  for (const match of matches) {
    const slug = match.groups?.slug;
    let alias = match.groups?.alias;
    if (!slug || !alias) {
      continue;
    }
    if (!identifiers.has(slug) || identifiers.get(slug) === null) {
      continue;
    }
    if (/^["`]/.test(alias)) {
      alias = alias.replace(/["`]/g, '');
    }
    const set = aliasMap.get(slug) ?? new Set<string>();
    set.add(alias);
    aliasMap.set(slug, set);
  }
  // ensure the slug itself is treated as an alias so references like slug.column resolve
  for (const [slug, identifier] of aliasMap.entries()) {
    if (identifier && !aliasMap.get(slug)?.has(slug)) {
      aliasMap.get(slug)?.add(slug);
    }
  }
  identifiers.forEach((identifier, slug) => {
    if (!identifier) {
      return;
    }
    const set = aliasMap.get(slug) ?? new Set<string>();
    set.add(slug);
    aliasMap.set(slug, set);
  });
  return aliasMap;
}

async function resolveDatasetTableIdentifier(slug: string): Promise<string | null> {
  if (DATASET_TABLE_CACHE.has(slug)) {
    return DATASET_TABLE_CACHE.get(slug) ?? null;
  }

  const dataset = await getDatasetBySlug(slug);
  if (!dataset) {
    DATASET_TABLE_CACHE.set(slug, null);
    return null;
  }

  const manifest = await getLatestPublishedManifest(dataset.id);
  let tableName: string | null = null;
  if (manifest && manifest.summary && typeof manifest.summary === 'object') {
    const summary = manifest.summary as Record<string, unknown>;
    if (typeof summary.tableName === 'string' && summary.tableName.trim().length > 0) {
      tableName = summary.tableName.trim();
    }
  }
  if (!tableName) {
    tableName = 'records';
  }

  const config = loadServiceConfig();
  const identifier = `${quoteClickHouseIdentifier(config.clickhouse.database)}.${quoteClickHouseIdentifier(
    deriveTableName(slug, tableName)
  )}`;
  DATASET_TABLE_CACHE.set(slug, identifier);
  return identifier;
}

function deriveResultColumns(rows: Array<Record<string, unknown>>): SqlSchemaColumnInfo[] {
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

function createFieldDefs(columns: SqlSchemaColumnInfo[]): FieldDef[] {
  return columns.map((column, index) => ({
    name: column.name,
    tableID: 0,
    columnID: index,
    dataTypeID: 0,
    dataTypeSize: 0,
    dataTypeModifier: 0,
    format: 'text'
  } satisfies FieldDef));
}

function inferTypeFromRows(rows: Array<Record<string, unknown>>, columnName: string): string {
  for (const row of rows) {
    const value = row[columnName];
    if (value === null || value === undefined) {
      continue;
    }
    if (isTimestampLike(value)) {
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

function normalizeSqlRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isInternalColumn(key)) {
      continue;
    }
    result[key] = normalizeSqlValue(value);
  }
  return result;
}

function isInternalColumn(name: string): boolean {
  return name.startsWith('__');
}

function normalizeSqlValue(value: unknown): unknown {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : value.toISOString();
  }

  const timestampLike = extractTimestampValue(value);
  if (timestampLike !== null) {
    return timestampLike;
  }

  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeSqlValue(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, normalizeSqlValue(nested)]);
    return Object.fromEntries(entries);
  }

  return value;
}

async function loadSqlSchemaTables(): Promise<SqlSchemaTableInfo[]> {
  const { datasets } = await listDatasets({ limit: 100, status: 'active' });
  const tables: SqlSchemaTableInfo[] = [];

  for (const dataset of datasets) {
    const columns: SqlSchemaColumnInfo[] = [];
    const manifest = await getLatestPublishedManifest(dataset.id);
    if (manifest?.schemaVersionId) {
      const schemaVersion = await getSchemaVersionById(manifest.schemaVersionId);
      if (schemaVersion) {
        const fieldDefs = normalizeFieldDefinitions(extractFieldDefinitions(schemaVersion.schema));
        for (const field of fieldDefs) {
          columns.push({
            name: field.name,
            type: mapFieldTypeToSqlType(field.type),
            nullable: true,
            description: null
          });
        }
      }
    }

    tables.push({
      name: dataset.slug,
      description: dataset.description,
      partitionKeys: [],
      columns
    });
  }

  return tables;
}

function mapFieldTypeToSqlType(type: string): string {
  switch (type) {
    case 'timestamp':
      return 'TIMESTAMP';
    case 'double':
      return 'DOUBLE';
    case 'integer':
      return 'BIGINT';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
    default:
      return 'VARCHAR';
  }
}

function mapClickHouseTypeToSqlType(type: string): string {
  const normalized = type.replace(/Nullable\((.+)\)/i, '$1').trim().toLowerCase();
  if (normalized.startsWith('date')) {
    return 'TIMESTAMP';
  }
  if (normalized.startsWith('decimal') || normalized.startsWith('float')) {
    return 'DOUBLE';
  }
  if (normalized.startsWith('int') || normalized.startsWith('uint')) {
    return 'BIGINT';
  }
  if (normalized === 'bool' || normalized === 'boolean') {
    return 'BOOLEAN';
  }
  if (normalized.startsWith('array(') || normalized.startsWith('map(')) {
    return 'JSON';
  }
  if (normalized.startsWith('tuple(')) {
    return 'JSON';
  }
  return 'VARCHAR';
}

function extractTimestampValue(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if ('toISOString' in value && typeof (value as { toISOString?: unknown }).toISOString === 'function') {
    try {
      const iso = (value as { toISOString: () => unknown }).toISOString();
      if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
        return iso;
      }
    } catch {
      return null;
    }
  }

  if ('toJSON' in value && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    try {
      const json = (value as { toJSON: () => unknown }).toJSON();
      if (typeof json === 'string' && !Number.isNaN(Date.parse(json))) {
        return json;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function isTimestampLike(value: unknown): boolean {
  if (value instanceof Date) {
    return true;
  }
  if (typeof value === 'string') {
    return !Number.isNaN(Date.parse(value));
  }
  return extractTimestampValue(value) !== null;
}

function padCell(value: string, width: number): string {
  if (value.length >= width) {
    return value;
  }
  return `${value}${' '.repeat(width - value.length)}`;
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
