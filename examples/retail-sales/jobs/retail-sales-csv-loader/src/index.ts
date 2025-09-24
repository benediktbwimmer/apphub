import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

type RetailCsvLoaderParameters = {
  dataRoot: string;
  partitionKey: string;
  datasetName?: string;
  sampleSize?: number;
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

type PartitionSummary = {
  partitionKey: string;
  sourceFile: string;
  rowCount: number;
  totals: {
    units: number;
    revenue: number;
    averageOrderValue: number;
  };
  byCategory: Array<{ category: string; units: number; revenue: number }>;
  byRegion: Array<{ region: string; revenue: number }>;
  channels: Array<{ channel: string; revenue: number }>;
  sample: RetailRecord[];
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

function parseParameters(raw: unknown): RetailCsvLoaderParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const dataRoot = ensureString(raw.dataRoot);
  if (!dataRoot) {
    throw new Error('dataRoot parameter is required');
  }

  const partitionKey = ensureString(raw.partitionKey || raw.partition);
  if (!partitionKey) {
    throw new Error('partitionKey parameter is required');
  }

  const sampleValue = raw.sampleSize;
  let sampleSize = 5;
  if (typeof sampleValue === 'number' && Number.isFinite(sampleValue)) {
    sampleSize = Math.min(20, Math.max(1, Math.floor(sampleValue)));
  }

  return {
    dataRoot,
    partitionKey,
    datasetName: ensureString(raw.datasetName) || 'retail_sales',
    sampleSize
  } satisfies RetailCsvLoaderParameters;
}

function parseCsv(content: string): RetailRecord[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  const headers = lines[0]?.split(',').map((header) => header.trim()) ?? [];
  const get = (values: string[], key: string): string => {
    const index = headers.indexOf(key);
    if (index === -1) {
      return '';
    }
    return values[index]?.trim() ?? '';
  };

  const records: RetailRecord[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine) {
      continue;
    }
    const parts = rawLine.split(',');
    const units = Number(get(parts, 'units'));
    const unitPrice = Number(get(parts, 'unit_price'));
    if (!Number.isFinite(units) || !Number.isFinite(unitPrice)) {
      continue;
    }
    const revenue = units * unitPrice;
    records.push({
      orderId: get(parts, 'order_id'),
      date: get(parts, 'date'),
      region: get(parts, 'region') || 'Unknown',
      category: get(parts, 'category') || 'Unknown',
      channel: get(parts, 'channel') || 'Unknown',
      units,
      unitPrice,
      revenue
    });
  }
  return records;
}

function summarize(partitionKey: string, fileName: string, records: RetailRecord[], sampleSize: number): PartitionSummary {
  const totals = records.reduce(
    (acc, record) => {
      acc.units += record.units;
      acc.revenue += record.revenue;
      return acc;
    },
    { units: 0, revenue: 0 }
  );

  const byCategory = new Map<string, { units: number; revenue: number }>();
  const byRegion = new Map<string, { revenue: number }>();
  const channels = new Map<string, { revenue: number }>();

  for (const record of records) {
    const cat = byCategory.get(record.category) ?? { units: 0, revenue: 0 };
    cat.units += record.units;
    cat.revenue += record.revenue;
    byCategory.set(record.category, cat);

    const region = byRegion.get(record.region) ?? { revenue: 0 };
    region.revenue += record.revenue;
    byRegion.set(record.region, region);

    const channel = channels.get(record.channel) ?? { revenue: 0 };
    channel.revenue += record.revenue;
    channels.set(record.channel, channel);
  }

  const sortedCategories = Array.from(byCategory.entries())
    .map(([category, stats]) => ({ category, units: stats.units, revenue: stats.revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  const sortedRegions = Array.from(byRegion.entries())
    .map(([region, stats]) => ({ region, revenue: stats.revenue }))
    .sort((a, b) => b.revenue - a.revenue);
  const sortedChannels = Array.from(channels.entries())
    .map(([channel, stats]) => ({ channel, revenue: stats.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const averageOrderValue = records.length > 0 ? totals.revenue / records.length : 0;

  return {
    partitionKey,
    sourceFile: fileName,
    rowCount: records.length,
    totals: {
      units: totals.units,
      revenue: Math.round(totals.revenue * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100
    },
    byCategory: sortedCategories,
    byRegion: sortedRegions,
    channels: sortedChannels,
    sample: records.slice(0, sampleSize)
  } satisfies PartitionSummary;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: RetailCsvLoaderParameters;
  try {
    parameters = parseParameters(context.parameters);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message };
  }

  const fileName = `${parameters.datasetName}_${parameters.partitionKey}.csv`;
  const filePath = path.resolve(parameters.dataRoot, fileName);

  context.logger('Loading partition CSV', {
    filePath,
    partitionKey: parameters.partitionKey
  });

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error reading CSV';
    return {
      status: 'failed',
      errorMessage: `Failed to read CSV for partition ${parameters.partitionKey}: ${message}`
    };
  }

  const records = parseCsv(content);
  if (records.length === 0) {
    return {
      status: 'failed',
      errorMessage: `CSV for ${parameters.partitionKey} did not contain any rows`
    };
  }

  await context.update({
    metrics: {
      rows: records.length,
      revenue: records.reduce((acc, record) => acc + record.revenue, 0)
    }
  });

  const summary = summarize(parameters.partitionKey, fileName, records, parameters.sampleSize ?? 5);
  const producedAt = new Date().toISOString();

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.partitionKey,
      records,
      summary,
      assets: [
        {
          assetId: 'retail.sales.raw',
          partitionKey: parameters.partitionKey,
          producedAt,
          payload: {
            partitionKey: parameters.partitionKey,
            sourceFile: filePath,
            totals: summary.totals,
            byCategory: summary.byCategory,
            byRegion: summary.byRegion,
            channels: summary.channels,
            sample: summary.sample
          }
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
