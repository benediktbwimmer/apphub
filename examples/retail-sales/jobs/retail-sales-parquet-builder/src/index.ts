import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ParquetSchema, ParquetWriter } from 'parquetjs-lite';

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

type RetailRecord = {
  orderId: string;
  date: string;
  region: string;
  category: string;
  channel: string;
  units: number;
  unitPrice: number;
  revenue: number;
};

type RawPartition = {
  partitionKey: string;
  records: RetailRecord[];
  summary?: {
    totals?: { units?: number; revenue?: number };
    byCategory?: Array<{ category: string; units: number; revenue: number }>;
    byRegion?: Array<{ region: string; revenue: number }>;
  };
};

type Parameters = {
  warehouseDir: string;
  partitionKey: string;
  rawPartition: RawPartition;
};

type PartitionSummary = {
  partitionKey: string;
  parquetFile: string;
  summaryFile: string;
  totals: {
    units: number;
    revenue: number;
    averageOrderValue: number;
  };
  byCategory: Array<{ category: string; units: number; revenue: number }>;
  byRegion: Array<{ region: string; revenue: number }>;
  channels: Array<{ channel: string; revenue: number }>;
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

function ensureNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeRecord(raw: unknown): RetailRecord | null {
  if (!isRecord(raw)) {
    return null;
  }
  const orderId = ensureString(raw.orderId ?? raw.order_id);
  const date = ensureString(raw.date ?? raw.orderDate ?? raw.order_date);
  const region = ensureString(raw.region) || 'Unknown';
  const category = ensureString(raw.category) || 'Unknown';
  const channel = ensureString(raw.channel) || 'Unknown';
  const units = ensureNumber(raw.units);
  const unitPrice = ensureNumber(raw.unitPrice ?? raw.unit_price);
  if (!orderId || !date || units <= 0) {
    return null;
  }
  const revenue = units * unitPrice;
  return { orderId, date, region, category, channel, units, unitPrice, revenue } satisfies RetailRecord;
}

function parseRawPartition(raw: unknown): RawPartition {
  if (!isRecord(raw)) {
    throw new Error('rawPartition must be an object');
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition_key);
  if (!partitionKey) {
    throw new Error('rawPartition.partitionKey is required');
  }

  const records = Array.isArray(raw.records)
    ? raw.records
        .map((entry) => normalizeRecord(entry))
        .filter((entry): entry is RetailRecord => Boolean(entry))
    : [];

  if (records.length === 0) {
    throw new Error('rawPartition.records must contain at least one entry');
  }

  const summary = isRecord(raw.summary) ? (raw.summary as RawPartition['summary']) : undefined;

  return { partitionKey, records, summary } satisfies RawPartition;
}

function parseParameters(raw: unknown): Parameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const warehouseDir = ensureString(raw.warehouseDir ?? raw.outputDir);
  if (!warehouseDir) {
    throw new Error('warehouseDir parameter is required');
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.partition);
  if (!partitionKey) {
    throw new Error('partitionKey parameter is required');
  }

  return {
    warehouseDir,
    partitionKey,
    rawPartition: parseRawPartition(raw.rawPartition ?? raw.partitionData)
  } satisfies Parameters;
}

function summarize(records: RetailRecord[]): PartitionSummary['totals'] {
  const totals = records.reduce(
    (acc, record) => {
      acc.units += record.units;
      acc.revenue += record.revenue;
      return acc;
    },
    { units: 0, revenue: 0 }
  );
  const averageOrderValue = records.length > 0 ? totals.revenue / records.length : 0;
  return {
    units: totals.units,
    revenue: Math.round(totals.revenue * 100) / 100,
    averageOrderValue: Math.round(averageOrderValue * 100) / 100
  };
}

function groupBy(records: RetailRecord[], key: keyof RetailRecord): Array<{ key: string; revenue: number; units: number }> {
  const map = new Map<string, { revenue: number; units: number }>();
  for (const record of records) {
    const value = ensureString(record[key]);
    const current = map.get(value) ?? { revenue: 0, units: 0 };
    current.revenue += record.revenue;
    current.units += record.units;
    map.set(value, current);
  }
  return Array.from(map.entries())
    .map(([entryKey, stats]) => ({ key: entryKey, revenue: stats.revenue, units: stats.units }))
    .sort((a, b) => b.revenue - a.revenue);
}

async function writeParquet(targetPath: string, records: RetailRecord[]): Promise<void> {
  const schema = new ParquetSchema({
    order_id: { type: 'UTF8' },
    order_date: { type: 'UTF8' },
    region: { type: 'UTF8' },
    category: { type: 'UTF8' },
    channel: { type: 'UTF8' },
    units: { type: 'INT64' },
    unit_price: { type: 'DOUBLE' },
    revenue: { type: 'DOUBLE' }
  });

  const writer = await ParquetWriter.openFile(schema, targetPath);
  try {
    for (const record of records) {
      await writer.appendRow({
        order_id: record.orderId,
        order_date: record.date,
        region: record.region,
        category: record.category,
        channel: record.channel,
        units: record.units,
        unit_price: record.unitPrice,
        revenue: record.revenue
      });
    }
  } finally {
    await writer.close();
  }
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: Parameters;
  try {
    parameters = parseParameters(context.parameters);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message };
  }

  const { warehouseDir, partitionKey, rawPartition } = parameters;
  await mkdir(warehouseDir, { recursive: true });

  const parquetFileName = `retail_sales_${partitionKey}.parquet`;
  const summaryFileName = `retail_sales_${partitionKey}.summary.json`;
  const parquetPath = path.resolve(warehouseDir, parquetFileName);
  const summaryPath = path.resolve(warehouseDir, summaryFileName);

  context.logger('Writing Parquet partition', { partitionKey, parquetPath });
  await writeParquet(parquetPath, rawPartition.records);

  const totals = summarize(rawPartition.records);
  const byCategory = groupBy(rawPartition.records, 'category').map(({ key, units, revenue }) => ({
    category: key,
    units,
    revenue: Math.round(revenue * 100) / 100
  }));
  const byRegion = groupBy(rawPartition.records, 'region').map(({ key, revenue }) => ({
    region: key,
    revenue: Math.round(revenue * 100) / 100
  }));
  const channels = groupBy(rawPartition.records, 'channel').map(({ key, revenue }) => ({
    channel: key,
    revenue: Math.round(revenue * 100) / 100
  }));

  const summary: PartitionSummary = {
    partitionKey,
    parquetFile: parquetPath,
    summaryFile: summaryPath,
    totals,
    byCategory,
    byRegion,
    channels
  } satisfies PartitionSummary;

  await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  await context.update({
    metrics: {
      parquetRows: rawPartition.records.length,
      parquetRevenue: totals.revenue
    }
  });

  const producedAt = new Date().toISOString();

  return {
    status: 'succeeded',
    result: {
      partitionKey,
      parquetFile: parquetPath,
      summaryFile: summaryPath,
      summary,
      assets: [
        {
          assetId: 'retail.sales.parquet',
          partitionKey,
          producedAt,
          payload: {
            partitionKey,
            parquetFile: parquetPath,
            summaryFile: summaryPath,
            totals,
            byCategory,
            byRegion,
            channels
          }
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
