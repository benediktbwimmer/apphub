import type { FieldDefinition, FieldType } from '../storage';
import type { ServiceConfig } from '../config/serviceConfig';
import type {
  HistogramBin,
  PartitionColumnBloomFilter,
  PartitionColumnBloomFilterMap,
  PartitionColumnStatistics,
  PartitionColumnStatisticsMap
} from '../types/partitionIndex';

interface PartitionIndexResult {
  columnStatistics: PartitionColumnStatisticsMap;
  columnBloomFilters: PartitionColumnBloomFilterMap;
}

interface PartitionIndexTarget {
  name: string;
  type: FieldType;
  histogram: boolean;
  bloom: boolean;
}

interface ColumnAccumulator {
  target: PartitionIndexTarget;
  nullCount: number;
  nonNullCount: number;
  distinctCount: number;
  distinctExact: boolean;
  min?: number | string | boolean;
  max?: number | string | boolean;
  minNumeric?: number;
  maxNumeric?: number;
}

const MAX_DISTINCT_TRACK = 10_000;

const HISTOGRAM_SUPPORTED_TYPES: FieldType[] = ['double', 'integer', 'timestamp'];

export function resolvePartitionIndexTargets(
  schemaFields: FieldDefinition[],
  config: ServiceConfig['partitionIndex']
): PartitionIndexTarget[] {
  if (!config.columns || config.columns.length === 0) {
    return [];
  }
  const schemaByName = new Map(schemaFields.map((field) => [field.name, field.type]));
  const targets: PartitionIndexTarget[] = [];
  for (const column of config.columns) {
    const type = schemaByName.get(column.name);
    if (!type) {
      continue;
    }
    const histogramEnabled = column.histogram && HISTOGRAM_SUPPORTED_TYPES.includes(type);
    targets.push({
      name: column.name,
      type,
      histogram: histogramEnabled,
      bloom: column.bloom
    });
  }
  return targets;
}

export function computePartitionIndexForRows(
  rows: Record<string, unknown>[],
  schemaFields: FieldDefinition[],
  config: ServiceConfig['partitionIndex']
): PartitionIndexResult {
  const targets = resolvePartitionIndexTargets(schemaFields, config);
  if (targets.length === 0 || rows.length === 0) {
    return { columnStatistics: {}, columnBloomFilters: {} };
  }

  const accumulators = new Map<string, ColumnAccumulator>();
  for (const target of targets) {
    accumulators.set(target.name, {
      target,
      nullCount: 0,
      nonNullCount: 0,
      distinctCount: 0,
      distinctExact: true
    });
  }

  const distinctSets = new Map<string, Set<string>>();

  for (const row of rows) {
    for (const target of targets) {
      const accumulator = accumulators.get(target.name);
      if (!accumulator) {
        continue;
      }
      const rawValue = row[target.name];
      if (rawValue === null || rawValue === undefined) {
        accumulator.nullCount += 1;
        continue;
      }
      const coerced = coerceValue(rawValue, target.type);
      if (!coerced) {
        accumulator.nullCount += 1;
        continue;
      }
      accumulator.nonNullCount += 1;
      updateMinMax(accumulator, coerced, target.type);

      if (accumulator.distinctExact) {
        let set = distinctSets.get(target.name);
        if (!set) {
          set = new Set<string>();
          distinctSets.set(target.name, set);
        }
        const key = valueToDistinctKey(coerced, target.type);
        set.add(key);
        if (set.size > MAX_DISTINCT_TRACK) {
          accumulator.distinctExact = false;
        } else {
          accumulator.distinctCount = set.size;
        }
      }
    }
  }

  for (const target of targets) {
    const accumulator = accumulators.get(target.name);
    if (!accumulator) {
      continue;
    }
    if (!accumulator.distinctExact) {
      const set = distinctSets.get(target.name);
      accumulator.distinctCount = set ? set.size : MAX_DISTINCT_TRACK;
    }
  }

  const histogramBinsByColumn = new Map<string, number[]>();
  const histogramBounds = new Map<string, { min: number; max: number }>();
  const bloomFilters = new Map<string, SimpleBloomFilter>();

  for (const target of targets) {
    const accumulator = accumulators.get(target.name);
    if (!accumulator) {
      continue;
    }
    if (target.histogram && accumulator.nonNullCount > 0 && accumulator.minNumeric !== undefined && accumulator.maxNumeric !== undefined) {
      const bins = Math.max(config.histogramBins, 1);
      histogramBinsByColumn.set(target.name, Array.from({ length: bins }, () => 0));
      histogramBounds.set(target.name, {
        min: accumulator.minNumeric,
        max: accumulator.maxNumeric
      });
    }
    if (target.bloom && accumulator.nonNullCount > 0) {
      bloomFilters.set(
        target.name,
        new SimpleBloomFilter(accumulator.nonNullCount, config.bloomFalsePositiveRate)
      );
    }
  }

  if (histogramBinsByColumn.size > 0 || bloomFilters.size > 0) {
    for (const row of rows) {
      for (const target of targets) {
        const rawValue = row[target.name];
        if (rawValue === null || rawValue === undefined) {
          continue;
        }
        const coerced = coerceValue(rawValue, target.type);
        if (!coerced) {
          continue;
        }
        const histogram = histogramBinsByColumn.get(target.name);
        if (histogram) {
          const bounds = histogramBounds.get(target.name);
          if (bounds) {
            updateHistogram(histogram, bounds, coerced, target.type);
          }
        }
        const bloom = bloomFilters.get(target.name);
        if (bloom) {
          bloom.add(valueToBloomKey(coerced, target.type));
        }
      }
    }
  }

  const columnStatistics: PartitionColumnStatisticsMap = {};
  const columnBloomFilters: PartitionColumnBloomFilterMap = {};
  const totalRows = rows.length;

  for (const target of targets) {
    const accumulator = accumulators.get(target.name);
    if (!accumulator) {
      continue;
    }
    const stats: PartitionColumnStatistics = {
      type: target.type,
      rowCount: totalRows,
      nullCount: accumulator.nullCount
    };
    if (accumulator.min !== undefined) {
      stats.min = accumulator.min;
    }
    if (accumulator.max !== undefined) {
      stats.max = accumulator.max;
    }
    if (accumulator.distinctCount > 0) {
      stats.distinctCount = accumulator.distinctCount;
      stats.distinctCountExact = accumulator.distinctExact;
    }
    const histogram = histogramBinsByColumn.get(target.name);
    if (histogram && accumulator.minNumeric !== undefined && accumulator.maxNumeric !== undefined) {
      stats.histogram = {
        bins: buildHistogramBins(histogram, accumulator.minNumeric, accumulator.maxNumeric, target.type)
      };
    }
    columnStatistics[target.name] = stats;

    const bloom = bloomFilters.get(target.name);
    if (bloom) {
      columnBloomFilters[target.name] = bloom.serialize(accumulator.nonNullCount, target.type);
    }
  }

  return { columnStatistics, columnBloomFilters };
}

export async function computePartitionIndexForConnection(
  connection: any,
  tableName: string,
  schemaFields: FieldDefinition[],
  config: ServiceConfig['partitionIndex']
): Promise<PartitionIndexResult> {
  const targets = resolvePartitionIndexTargets(schemaFields, config);
  if (targets.length === 0) {
    return { columnStatistics: {}, columnBloomFilters: {} };
  }

  const accumulators = new Map<string, ColumnAccumulator>();
  const histogramBinsByColumn = new Map<string, number[]>();
  const histogramBounds = new Map<string, { min: number; max: number }>();
  const bloomFilters = new Map<string, SimpleBloomFilter>();

  for (const target of targets) {
    const quotedColumn = quoteIdentifier(target.name);
    const quotedTable = quoteIdentifier(tableName);
    const statsRows = await all(connection, `SELECT
        COUNT(*)::BIGINT AS total_count,
        SUM(CASE WHEN ${quotedColumn} IS NULL THEN 1 ELSE 0 END)::BIGINT AS null_count,
        MIN(${quotedColumn}) AS min_value,
        MAX(${quotedColumn}) AS max_value,
        COUNT(DISTINCT ${quotedColumn})::BIGINT AS distinct_count
      FROM ${quotedTable}`);
    const statsRow = statsRows[0] ?? {};
    const totalCount = Number(statsRow.total_count ?? 0);
    const nullCount = Number(statsRow.null_count ?? 0);
    const nonNullCount = Math.max(totalCount - nullCount, 0);
    const coercedMin = coerceValue(statsRow.min_value, target.type);
    const coercedMax = coerceValue(statsRow.max_value, target.type);

    const accumulator: ColumnAccumulator = {
      target,
      nullCount,
      nonNullCount,
      distinctCount: Number(statsRow.distinct_count ?? 0),
      distinctExact: true
    };
    if (coercedMin) {
      accumulator.min = storedValue(coercedMin, target.type);
      if (isNumericType(target.type)) {
        accumulator.minNumeric = numericValue(coercedMin, target.type);
      }
    }
    if (coercedMax) {
      accumulator.max = storedValue(coercedMax, target.type);
      if (isNumericType(target.type)) {
        accumulator.maxNumeric = numericValue(coercedMax, target.type);
      }
    }
    accumulators.set(target.name, accumulator);

    if (target.histogram && nonNullCount > 0 && accumulator.minNumeric !== undefined && accumulator.maxNumeric !== undefined) {
      const bins = Math.max(config.histogramBins, 1);
      histogramBinsByColumn.set(target.name, Array.from({ length: bins }, () => 0));
      histogramBounds.set(target.name, {
        min: accumulator.minNumeric,
        max: accumulator.maxNumeric
      });
    }
    if (target.bloom && nonNullCount > 0) {
      bloomFilters.set(target.name, new SimpleBloomFilter(nonNullCount, config.bloomFalsePositiveRate));
    }

    if ((target.histogram && histogramBinsByColumn.has(target.name)) || bloomFilters.has(target.name)) {
      const valueRows = await all(
        connection,
        `SELECT ${quotedColumn} AS value FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL`
      );
      const histogram = histogramBinsByColumn.get(target.name);
      const bounds = histogramBounds.get(target.name);
      const bloom = bloomFilters.get(target.name);
      for (const row of valueRows) {
        const coerced = coerceValue(row.value, target.type);
        if (!coerced) {
          continue;
        }
        if (histogram && bounds) {
          updateHistogram(histogram, bounds, coerced, target.type);
        }
        if (bloom) {
          bloom.add(valueToBloomKey(coerced, target.type));
        }
      }
    }
  }

  const columnStatistics: PartitionColumnStatisticsMap = {};
  const columnBloomFilters: PartitionColumnBloomFilterMap = {};

  for (const target of targets) {
    const accumulator = accumulators.get(target.name);
    if (!accumulator) {
      continue;
    }
    const stats: PartitionColumnStatistics = {
      type: target.type,
      rowCount: accumulator.nullCount + accumulator.nonNullCount,
      nullCount: accumulator.nullCount
    };
    if (accumulator.min !== undefined) {
      stats.min = accumulator.min;
    }
    if (accumulator.max !== undefined) {
      stats.max = accumulator.max;
    }
    if (accumulator.distinctCount > 0) {
      stats.distinctCount = accumulator.distinctCount;
      stats.distinctCountExact = accumulator.distinctExact;
    }
    const histogram = histogramBinsByColumn.get(target.name);
    if (histogram && accumulator.minNumeric !== undefined && accumulator.maxNumeric !== undefined) {
      stats.histogram = {
        bins: buildHistogramBins(histogram, accumulator.minNumeric, accumulator.maxNumeric, target.type)
      };
    }
    columnStatistics[target.name] = stats;

    const bloom = bloomFilters.get(target.name);
    if (bloom) {
      columnBloomFilters[target.name] = bloom.serialize(accumulator.nonNullCount, target.type);
    }
  }

  return { columnStatistics, columnBloomFilters };
}

function updateMinMax(
  accumulator: ColumnAccumulator,
  value: CoercedValue,
  type: FieldType
): void {
  if (accumulator.min === undefined) {
    accumulator.min = storedValue(value, type);
    if (isNumericType(type)) {
      accumulator.minNumeric = numericValue(value, type);
    }
  } else if (compareValues(value, accumulator.min, type) < 0) {
    accumulator.min = storedValue(value, type);
    if (isNumericType(type)) {
      accumulator.minNumeric = numericValue(value, type);
    }
  }

  if (accumulator.max === undefined) {
    accumulator.max = storedValue(value, type);
    if (isNumericType(type)) {
      accumulator.maxNumeric = numericValue(value, type);
    }
  } else if (compareValues(value, accumulator.max, type) > 0) {
    accumulator.max = storedValue(value, type);
    if (isNumericType(type)) {
      accumulator.maxNumeric = numericValue(value, type);
    }
  }
}

function updateHistogram(
  histogram: number[],
  bounds: { min: number; max: number },
  value: CoercedValue,
  type: FieldType
): void {
  if (!isNumericType(type)) {
    return;
  }
  const numeric = numericValue(value, type);
  const { min, max } = bounds;
  if (max === min) {
    histogram[0] += 1;
    return;
  }
  const position = (numeric - min) / (max - min);
  const index = Math.min(histogram.length - 1, Math.max(0, Math.floor(position * histogram.length)));
  histogram[index] += 1;
}

function buildHistogramBins(
  histogram: number[],
  min: number,
  max: number,
  type: FieldType
): HistogramBin[] {
  if (max === min) {
    return [
      {
        lower: formatNumeric(min, type),
        upper: formatNumeric(max, type),
        count: histogram.reduce((sum, value) => sum + value, 0)
      }
    ];
  }
  const interval = (max - min) / histogram.length;
  const bins: HistogramBin[] = [];
  for (let index = 0; index < histogram.length; index += 1) {
    const lowerNumeric = min + index * interval;
    const upperNumeric = index === histogram.length - 1 ? max : lowerNumeric + interval;
    bins.push({
      lower: formatNumeric(lowerNumeric, type),
      upper: formatNumeric(upperNumeric, type),
      count: histogram[index]
    });
  }
  return bins;
}

function storedValue(value: CoercedValue, type: FieldType): number | string | boolean {
  switch (type) {
    case 'timestamp':
      return new Date(value.numeric).toISOString();
    case 'double':
    case 'integer':
      return value.numeric;
    case 'boolean':
      return value.boolean;
    case 'string':
    default:
      return value.text;
  }
}

function numericValue(value: CoercedValue, type: FieldType): number {
  if (type === 'timestamp') {
    return value.numeric;
  }
  if (type === 'double' || type === 'integer') {
    return value.numeric;
  }
  throw new Error(`Numeric conversion not supported for type ${type}`);
}

function formatNumeric(value: number, type: FieldType): number | string {
  if (type === 'timestamp') {
    return new Date(value).toISOString();
  }
  return value;
}

function compareValues(value: CoercedValue, baseline: number | string | boolean, type: FieldType): number {
  switch (type) {
    case 'timestamp': {
      const baselineTime = baseline instanceof Date
        ? baseline.getTime()
        : new Date(String(baseline)).getTime();
      return numericValue(value, type) - baselineTime;
    }
    case 'double':
    case 'integer':
      return numericValue(value, type) - Number(baseline);
    case 'boolean':
      return Number(value.boolean) - Number(baseline);
    case 'string':
    default:
      return value.text.localeCompare(String(baseline));
  }
}

function valueToDistinctKey(value: CoercedValue, type: FieldType): string {
  switch (type) {
    case 'timestamp':
      return new Date(value.numeric).toISOString();
    case 'double':
    case 'integer':
      return String(value.numeric);
    case 'boolean':
      return value.boolean ? 'true' : 'false';
    case 'string':
    default:
      return value.text;
  }
}

function valueToBloomKey(value: CoercedValue, type: FieldType): string {
  switch (type) {
    case 'timestamp':
      return new Date(value.numeric).toISOString();
    case 'double':
    case 'integer':
      return String(value.numeric);
    case 'boolean':
      return value.boolean ? 'true' : 'false';
    case 'string':
    default:
      return value.text;
  }
}

type CoercedValue =
  | { type: 'number'; numeric: number }
  | { type: 'timestamp'; numeric: number }
  | { type: 'string'; text: string }
  | { type: 'boolean'; boolean: boolean };

function coerceValue(value: unknown, type: FieldType): CoercedValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  switch (type) {
    case 'double':
    case 'integer': {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return { type: 'number', numeric };
      }
      return null;
    }
    case 'timestamp': {
      const date = value instanceof Date ? value : new Date(String(value));
      const time = date.getTime();
      if (Number.isFinite(time)) {
        return { type: 'timestamp', numeric: time };
      }
      return null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return { type: 'boolean', boolean: value };
      }
      if (value === 'true' || value === 'false') {
        return { type: 'boolean', boolean: value === 'true' };
      }
      return null;
    }
    case 'string':
    default:
      return { type: 'string', text: String(value) };
  }
}

function isNumericType(type: FieldType): boolean {
  return type === 'double' || type === 'integer' || type === 'timestamp';
}

class SimpleBloomFilter {
  readonly m: number;
  readonly k: number;
  private readonly bits: Uint8Array;

  constructor(expectedItems: number, falsePositiveRate: number) {
    const params = computeBloomParameters(expectedItems, falsePositiveRate);
    this.m = params.m;
    this.k = params.k;
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
  }

  add(value: string): void {
    if (!value) {
      return;
    }
    const hashes = computeHashes(value, this.k, this.m);
    for (const position of hashes) {
      const byteIndex = Math.floor(position / 8);
      const bitIndex = position % 8;
      this.bits[byteIndex] |= 1 << bitIndex;
    }
  }

  serialize(rowCount: number, type: FieldType) {
    return {
      type,
      hash: 'fnv1a32' as const,
      m: this.m,
      k: this.k,
      bits: Buffer.from(this.bits).toString('base64'),
      rowCount
    };
  }
}

function computeBloomParameters(expectedItems: number, falsePositiveRate: number): { m: number; k: number } {
  const n = Math.max(expectedItems, 1);
  const p = Math.min(Math.max(falsePositiveRate, 1e-6), 0.5);
  const m = Math.ceil((-n * Math.log(p)) / (Math.log(2) ** 2));
  const k = Math.max(1, Math.round((m / n) * Math.log(2)));
  return { m, k };
}

function computeHashes(value: string, k: number, m: number): number[] {
  const results: number[] = [];
  const h1 = fnv1a32(value, 0);
  const h2 = fnv1a32(value, 1) || 1;
  for (let i = 0; i < k; i += 1) {
    const combined = (h1 + i * h2) % m;
    results.push((combined + m) % m);
  }
  return results;
}

function fnv1a32(value: string, seed: number): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function testBloomFilter(filter: PartitionColumnBloomFilter, value: string): boolean {
  if (!value) {
    return false;
  }
  if (filter.hash !== 'fnv1a32') {
    return true;
  }
  const bits = Buffer.from(filter.bits, 'base64');
  const hashes = computeHashes(value, filter.k, filter.m);
  for (const position of hashes) {
    const byteIndex = Math.floor(position / 8);
    const bitIndex = position % 8;
    if ((bits[byteIndex] & (1 << bitIndex)) === 0) {
      return false;
    }
  }
  return true;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function all(connection: any, sql: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    connection.all(sql, (err: Error | null, rows?: Record<string, unknown>[]) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
}
