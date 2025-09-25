import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import duckdb from 'duckdb';

type JobRunStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

type JobRunResult = {
  status?: JobRunStatus;
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

type RawAssetSourceFile = {
  relativePath: string;
  site?: string;
  instrumentId?: string;
  rows?: number;
};

type RawAsset = {
  partitionKey: string;
  minute: string;
  stagingDir: string;
  sourceFiles: RawAssetSourceFile[];
};

type DuckDbLoaderParameters = {
  warehousePath: string;
  minute: string;
  rawAsset: RawAsset;
  vacuum: boolean;
};

type DuckDbAssetPayload = {
  partitionKey: string;
  warehousePath: string;
  appendedRows: number;
  totalRows: number;
  tables: Array<{ name: string; rowCount: number }>;
  checkpointCreatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function ensureBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
}

function parseRawAsset(raw: unknown): RawAsset {
  if (!isRecord(raw)) {
    throw new Error('rawAsset parameter must be an object');
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.hour ?? raw.partition_key);
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  const stagingDir = ensureString(raw.stagingDir ?? raw.staging_dir);
  const sourceFilesRaw = Array.isArray(raw.sourceFiles ?? raw.source_files)
    ? ((raw.sourceFiles ?? raw.source_files) as unknown[])
    : [];
  const sourceFiles: RawAssetSourceFile[] = [];
  for (const entryRaw of sourceFilesRaw) {
    if (!isRecord(entryRaw)) {
      continue;
    }
    const relativePath = ensureString(entryRaw.relativePath ?? entryRaw.path ?? entryRaw.relative_path);
    if (!relativePath) {
      continue;
    }
    const site = ensureString(entryRaw.site ?? entryRaw.location ?? '');
    const instrumentId = ensureString(entryRaw.instrumentId ?? entryRaw.instrument_id ?? '');
    const rows = typeof entryRaw.rows === 'number' ? entryRaw.rows : undefined;
    sourceFiles.push({
      relativePath,
      site: site || undefined,
      instrumentId: instrumentId || undefined,
      rows
    });
  }

  if (!partitionKey || !minute || !stagingDir || sourceFiles.length === 0) {
    throw new Error('rawAsset must include partitionKey/minute, stagingDir, and at least one source file');
  }

  return {
    partitionKey,
    minute,
    stagingDir,
    sourceFiles
  } satisfies RawAsset;
}

function parseParameters(raw: unknown): DuckDbLoaderParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const warehousePath = ensureString(raw.warehousePath ?? raw.warehouse_path ?? raw.output);
  if (!warehousePath) {
    throw new Error('warehousePath parameter is required');
  }
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute) {
    throw new Error('minute parameter is required');
  }
  const rawAsset = parseRawAsset(raw.rawAsset ?? raw.raw_asset);
  const vacuum = ensureBoolean(raw.vacuum, false);
  return { warehousePath, minute, rawAsset, vacuum } satisfies DuckDbLoaderParameters;
}

function escapeLiteral(value: string): string {
  return value.split("'").join("''");
}

function resolveSourcePath(stagingDir: string, entry: RawAssetSourceFile): string {
  return path.resolve(stagingDir, entry.relativePath);
}

type DuckDbConnection = {
  run: (sql: string, callback: (err: Error | null) => void) => void;
  all: (sql: string, callback: (err: Error | null, rows?: unknown[]) => void) => void;
  close: () => void;
};

function runQuery(connection: DuckDbConnection, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.run(sql, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function allRows<T>(connection: DuckDbConnection, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve((rows ?? []) as T[]);
    });
  });
}

async function getScalar(connection: DuckDbConnection, sql: string): Promise<number> {
  const rows = await allRows<{ value: number | bigint | string | null | undefined }>(connection, sql);
  const value = rows[0]?.value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const absoluteWarehousePath = path.resolve(parameters.warehousePath);
  await mkdir(path.dirname(absoluteWarehousePath), { recursive: true });

  const db = new duckdb.Database(absoluteWarehousePath);
  const connection = db.connect();

  try {
    await runQuery(
      connection,
      `CREATE TABLE IF NOT EXISTS readings (
        timestamp TIMESTAMP WITH TIME ZONE,
        instrument_id VARCHAR,
        site VARCHAR,
        temperature_c DOUBLE,
        relative_humidity_pct DOUBLE,
        pm2_5_ug_m3 DOUBLE,
        battery_voltage DOUBLE
      )`
    );

    const minuteLiteral = escapeLiteral(parameters.minute);
    const minuteExpression = `strftime(timestamp AT TIME ZONE 'UTC', '%Y-%m-%dT%H:%M')`;
    await runQuery(
      connection,
      `DELETE FROM readings WHERE ${minuteExpression} = '${minuteLiteral}'`
    );

    for (const source of parameters.rawAsset.sourceFiles) {
      const absolutePath = resolveSourcePath(parameters.rawAsset.stagingDir, source);
      const escapedPath = escapeLiteral(absolutePath);
      await runQuery(
        connection,
        `INSERT INTO readings
         SELECT
           CAST(timestamp AS TIMESTAMP WITH TIME ZONE) AS timestamp,
           CAST(instrument_id AS VARCHAR) AS instrument_id,
           CAST(site AS VARCHAR) AS site,
           CAST(temperature_c AS DOUBLE) AS temperature_c,
           CAST(relative_humidity_pct AS DOUBLE) AS relative_humidity_pct,
           CAST(pm2_5_ug_m3 AS DOUBLE) AS pm2_5_ug_m3,
           CAST(battery_voltage AS DOUBLE) AS battery_voltage
         FROM read_csv_auto('${escapedPath}',
           HEADER=TRUE,
           SAMPLE_SIZE=-1,
           IGNORE_ERRORS=TRUE,
           AUTO_DETECT=TRUE
         )`
      );
    }

    const appendedRows = await getScalar(
      connection,
      `SELECT COUNT(*)::INTEGER AS value FROM readings WHERE ${minuteExpression} = '${minuteLiteral}'`
    );
    const totalRows = await getScalar(connection, 'SELECT COUNT(*)::INTEGER AS value FROM readings');

    let tables = await allRows<{ name: string }>(
      connection,
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
    );
    if (!Array.isArray(tables) || tables.length === 0) {
      tables = [{ name: 'readings' }];
    }
    const tableCounts: Array<{ name: string; rowCount: number }> = [];
    for (const table of tables) {
      const name = table.name ?? 'readings';
      const escaped = escapeLiteral(name);
      const rowCount = await getScalar(
        connection,
        `SELECT COUNT(*)::INTEGER AS value FROM "${escaped}"`
      );
      tableCounts.push({ name, rowCount });
    }

    if (parameters.vacuum) {
      await runQuery(connection, 'VACUUM');
    }

    const checkpointCreatedAt = new Date().toISOString();
    const payload: DuckDbAssetPayload = {
      partitionKey: parameters.minute,
      warehousePath: absoluteWarehousePath,
      appendedRows,
      totalRows,
      tables: tableCounts,
      checkpointCreatedAt
    } satisfies DuckDbAssetPayload;

    await context.update({
      appendedRows,
      totalRows
    });

    return {
      status: 'succeeded',
      result: {
        partitionKey: parameters.minute,
        snapshot: payload,
        assets: [
          {
            assetId: 'observatory.timeseries.duckdb',
            partitionKey: parameters.minute,
            producedAt: checkpointCreatedAt,
            payload
          }
        ]
      }
    } satisfies JobRunResult;
  } finally {
    connection.close();
    db.close();
  }
}

export default handler;
