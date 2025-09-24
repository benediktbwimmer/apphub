import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

type TelemetryMetricsParameters = {
  dataRoot: string;
  instrumentId: string;
  day: string;
  temperatureLimitC: number;
  humidityLimitPct: number;
  outputDir?: string;
};

type TelemetrySample = {
  timestamp: string;
  temperatureC: number;
  humidityPct: number;
  qualityFlag: string;
};

type TelemetryMetrics = {
  samples: number;
  temperatureC: { min: number; max: number; mean: number };
  humidityPct: { min: number; max: number; mean: number };
};

type TelemetryAnomalyWindow = {
  flagged: boolean;
  reason?: string;
  firstSample?: string;
  lastSample?: string;
};

type TelemetryPayload = {
  partitionKey: string;
  instrumentId: string;
  day: string;
  aggregatedAt: string;
  sourceFiles: Array<{ relativePath: string; samples: number }>;
  metrics: TelemetryMetrics;
  anomalyWindow: TelemetryAnomalyWindow;
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

function ensureNumber(value: unknown, fallback: number): number {
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

function parseParameters(raw: unknown): TelemetryMetricsParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const dataRoot = ensureString(raw.dataRoot ?? raw.data_dir);
  if (!dataRoot) {
    throw new Error('dataRoot parameter is required');
  }

  const instrumentId = ensureString(raw.instrumentId ?? raw.partitionKey ?? raw.instrument_id);
  if (!instrumentId) {
    throw new Error('instrumentId parameter is required');
  }

  const day = ensureString(raw.day ?? raw.date);
  if (!day) {
    throw new Error('day parameter is required');
  }

  const temperatureLimitC = ensureNumber(raw.temperatureLimitC, 30);
  const humidityLimitPct = ensureNumber(raw.humidityLimitPct, 65);

  const outputDirRaw = ensureString(raw.outputDir ?? raw.metricsDir ?? '');

  return {
    dataRoot,
    instrumentId,
    day,
    temperatureLimitC,
    humidityLimitPct,
    outputDir: outputDirRaw || undefined
  } satisfies TelemetryMetricsParameters;
}

function parseCsv(content: string): TelemetrySample[] {
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

  const samples: TelemetrySample[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (!rawLine) {
      continue;
    }
    const parts = rawLine.split(',');
    const timestamp = get(parts, 'timestamp');
    const temperature = Number(get(parts, 'temperature_c'));
    const humidity = Number(get(parts, 'humidity_pct'));
    if (!timestamp || Number.isNaN(temperature) || Number.isNaN(humidity)) {
      continue;
    }
    samples.push({
      timestamp,
      temperatureC: temperature,
      humidityPct: humidity,
      qualityFlag: get(parts, 'quality_flag') || 'UNKNOWN'
    });
  }
  return samples;
}

function computeMetrics(samples: TelemetrySample[]): TelemetryMetrics {
  if (samples.length === 0) {
    return {
      samples: 0,
      temperatureC: { min: 0, max: 0, mean: 0 },
      humidityPct: { min: 0, max: 0, mean: 0 }
    } satisfies TelemetryMetrics;
  }

  let tempMin = Number.POSITIVE_INFINITY;
  let tempMax = Number.NEGATIVE_INFINITY;
  let humidityMin = Number.POSITIVE_INFINITY;
  let humidityMax = Number.NEGATIVE_INFINITY;
  let tempSum = 0;
  let humiditySum = 0;

  for (const sample of samples) {
    tempMin = Math.min(tempMin, sample.temperatureC);
    tempMax = Math.max(tempMax, sample.temperatureC);
    humidityMin = Math.min(humidityMin, sample.humidityPct);
    humidityMax = Math.max(humidityMax, sample.humidityPct);
    tempSum += sample.temperatureC;
    humiditySum += sample.humidityPct;
  }

  const round = (value: number) => Math.round(value * 100) / 100;

  return {
    samples: samples.length,
    temperatureC: {
      min: round(tempMin),
      max: round(tempMax),
      mean: round(tempSum / samples.length)
    },
    humidityPct: {
      min: round(humidityMin),
      max: round(humidityMax),
      mean: round(humiditySum / samples.length)
    }
  } satisfies TelemetryMetrics;
}

function determineAnomalies(
  samples: TelemetrySample[],
  limits: { temperatureLimitC: number; humidityLimitPct: number }
): TelemetryAnomalyWindow {
  const reasonParts = new Set<string>();
  const flaggedSamples: TelemetrySample[] = [];

  for (const sample of samples) {
    let isFlagged = false;
    if (sample.qualityFlag && sample.qualityFlag.toUpperCase() !== 'OK') {
      reasonParts.add('quality_flag');
      isFlagged = true;
    }
    if (sample.temperatureC > limits.temperatureLimitC) {
      reasonParts.add('temperature');
      isFlagged = true;
    }
    if (sample.humidityPct > limits.humidityLimitPct) {
      reasonParts.add('humidity');
      isFlagged = true;
    }
    if (isFlagged) {
      flaggedSamples.push(sample);
    }
  }

  if (flaggedSamples.length === 0) {
    return { flagged: false } satisfies TelemetryAnomalyWindow;
  }

  flaggedSamples.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  return {
    flagged: true,
    reason: Array.from(reasonParts).join(', ') || 'anomaly',
    firstSample: flaggedSamples[0]?.timestamp,
    lastSample: flaggedSamples[flaggedSamples.length - 1]?.timestamp
  } satisfies TelemetryAnomalyWindow;
}

function buildPayload(args: {
  parameters: TelemetryMetricsParameters;
  samples: TelemetrySample[];
  metrics: TelemetryMetrics;
  anomalyWindow: TelemetryAnomalyWindow;
  dataRelativePath: string;
  aggregatedAt: string;
  summaryRelativePath?: string;
}): TelemetryPayload {
  const sourceFiles: Array<{ relativePath: string; samples: number }> = [
    { relativePath: args.dataRelativePath, samples: args.samples.length }
  ];

  if (args.summaryRelativePath) {
    sourceFiles.push({ relativePath: args.summaryRelativePath, samples: args.samples.length });
  }

  return {
    partitionKey: args.parameters.instrumentId,
    instrumentId: args.parameters.instrumentId,
    day: args.parameters.day,
    aggregatedAt: args.aggregatedAt,
    sourceFiles,
    metrics: args.metrics,
    anomalyWindow: args.anomalyWindow
  } satisfies TelemetryPayload;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: TelemetryMetricsParameters;
  try {
    parameters = parseParameters(context.parameters);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message } satisfies JobRunResult;
  }

  const normalizedDay = parameters.day.replace(/-/g, '');
  const csvFileName = `${parameters.instrumentId}_${normalizedDay}.csv`;
  const csvPath = path.resolve(parameters.dataRoot, parameters.instrumentId, csvFileName);
  const dataRelativePath = path.join(parameters.instrumentId, csvFileName);

  context.logger('Aggregating instrument telemetry', {
    instrumentId: parameters.instrumentId,
    day: parameters.day,
    csvPath
  });

  let content: string;
  try {
    content = await readFile(csvPath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error reading CSV';
    return {
      status: 'failed',
      errorMessage: `Failed to read telemetry for ${parameters.instrumentId} on ${parameters.day}: ${message}`
    } satisfies JobRunResult;
  }

  const samples = parseCsv(content);
  if (samples.length === 0) {
    return {
      status: 'failed',
      errorMessage: `Telemetry file ${csvFileName} did not contain any readings`
    } satisfies JobRunResult;
  }

  const metrics = computeMetrics(samples);
  const anomalyWindow = determineAnomalies(samples, {
    temperatureLimitC: parameters.temperatureLimitC,
    humidityLimitPct: parameters.humidityLimitPct
  });

  const aggregatedAt = new Date().toISOString();
  let summaryRelativePath: string | undefined;

  if (parameters.outputDir) {
    const summaryFileName = `${parameters.instrumentId}_${normalizedDay}.json`;
    const summaryPath = path.resolve(parameters.outputDir, summaryFileName);
    try {
      await mkdir(parameters.outputDir, { recursive: true });
      const payload = buildPayload({
        parameters,
        samples,
        metrics,
        anomalyWindow,
        dataRelativePath,
        aggregatedAt
      });
      await writeFile(summaryPath, JSON.stringify(payload, null, 2), 'utf8');
      summaryRelativePath = path.join(path.basename(parameters.outputDir), summaryFileName);
    } catch (err) {
      context.logger('Failed to persist summary file', {
        error: err instanceof Error ? err.message : String(err),
        summaryPath
      });
    }
  }

  await context.update({
    metrics: {
      samples: metrics.samples,
      anomaly: anomalyWindow.flagged ? 1 : 0
    }
  });

  const payload = buildPayload({
    parameters,
    samples,
    metrics,
    anomalyWindow,
    dataRelativePath,
    aggregatedAt,
    summaryRelativePath
  });

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.instrumentId,
      telemetry: payload,
      assets: [
        {
          assetId: 'greenhouse.telemetry.instrument',
          partitionKey: parameters.instrumentId,
          producedAt: aggregatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
