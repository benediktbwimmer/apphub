import { readFile, readdir } from 'node:fs/promises';
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

type TelemetrySnapshot = {
  partitionKey: string;
  instrumentId: string;
  day: string;
  aggregatedAt: string;
  metrics: TelemetryMetrics;
  anomalyWindow: TelemetryAnomalyWindow;
};

type AlertsParameters = {
  telemetryDir?: string;
  windowHours: number;
  temperatureLimitC: number;
  humidityLimitPct: number;
};

type AlertRecord = {
  partitionKey: string;
  instrumentId: string;
  reason: string;
  lastReadingAt: string;
  latestMetrics: TelemetryMetrics;
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

function parseParameters(raw: unknown): AlertsParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const telemetryDir = ensureString(raw.telemetryDir ?? raw.telemetry_dir ?? '');
  const windowHours = Math.max(1, Math.min(168, Math.floor(ensureNumber(raw.windowHours, 24))));
  const temperatureLimitC = ensureNumber(raw.temperatureLimitC, 30);
  const humidityLimitPct = ensureNumber(raw.humidityLimitPct, 65);

  return {
    telemetryDir: telemetryDir || undefined,
    windowHours,
    temperatureLimitC,
    humidityLimitPct
  } satisfies AlertsParameters;
}

function parseTelemetrySnapshot(raw: unknown): TelemetrySnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }
  const partitionKey = ensureString(raw.partitionKey ?? raw.instrumentId ?? '');
  const instrumentId = ensureString(raw.instrumentId ?? raw.partitionKey ?? '');
  const day = ensureString(raw.day ?? '');
  const aggregatedAt = ensureString(raw.aggregatedAt ?? raw.generatedAt ?? '');
  const metricsRaw = isRecord(raw.metrics) ? raw.metrics : null;
  const anomalyRaw = isRecord(raw.anomalyWindow) ? raw.anomalyWindow : null;

  if (!partitionKey || !instrumentId || !aggregatedAt || !metricsRaw) {
    return null;
  }

  const metrics: TelemetryMetrics = {
    samples: ensureNumber(metricsRaw.samples, 0),
    temperatureC: {
      min: ensureNumber(isRecord(metricsRaw.temperatureC) ? metricsRaw.temperatureC.min : undefined, 0),
      max: ensureNumber(isRecord(metricsRaw.temperatureC) ? metricsRaw.temperatureC.max : undefined, 0),
      mean: ensureNumber(isRecord(metricsRaw.temperatureC) ? metricsRaw.temperatureC.mean : undefined, 0)
    },
    humidityPct: {
      min: ensureNumber(isRecord(metricsRaw.humidityPct) ? metricsRaw.humidityPct.min : undefined, 0),
      max: ensureNumber(isRecord(metricsRaw.humidityPct) ? metricsRaw.humidityPct.max : undefined, 0),
      mean: ensureNumber(isRecord(metricsRaw.humidityPct) ? metricsRaw.humidityPct.mean : undefined, 0)
    }
  } satisfies TelemetryMetrics;

  const anomalyWindow: TelemetryAnomalyWindow = {
    flagged: Boolean(anomalyRaw?.flagged),
    reason: ensureString(anomalyRaw?.reason ?? ''),
    firstSample: anomalyRaw?.firstSample ? ensureString(anomalyRaw.firstSample) : undefined,
    lastSample: anomalyRaw?.lastSample ? ensureString(anomalyRaw.lastSample) : undefined
  } satisfies TelemetryAnomalyWindow;

  return {
    partitionKey,
    instrumentId,
    day,
    aggregatedAt,
    metrics,
    anomalyWindow
  } satisfies TelemetrySnapshot;
}

async function loadTelemetrySnapshots(
  directory: string | undefined,
  logger?: (message: string, meta?: Record<string, unknown>) => void
): Promise<TelemetrySnapshot[]> {
  if (!directory) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (err) {
    throw new Error(
      `Failed to read telemetry directory ${directory}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const snapshots: TelemetrySnapshot[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    const filePath = path.resolve(directory, entry);
    try {
      const content = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      const snapshot = parseTelemetrySnapshot(parsed);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    } catch (err) {
      logger?.('Skipping telemetry summary', {
        file: entry,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return snapshots;
}

function selectLatestSnapshots(snapshots: TelemetrySnapshot[]): TelemetrySnapshot[] {
  const latestByInstrument = new Map<string, TelemetrySnapshot>();
  for (const snapshot of snapshots) {
    const existing = latestByInstrument.get(snapshot.instrumentId);
    if (!existing) {
      latestByInstrument.set(snapshot.instrumentId, snapshot);
      continue;
    }
    if (snapshot.day && existing.day && snapshot.day > existing.day) {
      latestByInstrument.set(snapshot.instrumentId, snapshot);
      continue;
    }
    if (!existing.day && snapshot.aggregatedAt > existing.aggregatedAt) {
      latestByInstrument.set(snapshot.instrumentId, snapshot);
    }
  }
  return Array.from(latestByInstrument.values()).sort((a, b) =>
    a.instrumentId.localeCompare(b.instrumentId)
  );
}

function evaluateAlerts(
  snapshots: TelemetrySnapshot[],
  parameters: AlertsParameters
): { flagged: AlertRecord[]; totalPartitions: number } {
  const flagged: AlertRecord[] = [];

  for (const snapshot of snapshots) {
    const reasons = new Set<string>();
    if (snapshot.anomalyWindow.flagged) {
      reasons.add(snapshot.anomalyWindow.reason || 'anomaly');
    }
    if (snapshot.metrics.temperatureC.max > parameters.temperatureLimitC) {
      reasons.add('temperature');
    }
    if (snapshot.metrics.humidityPct.max > parameters.humidityLimitPct) {
      reasons.add('humidity');
    }

    if (reasons.size === 0) {
      continue;
    }

    const reason = Array.from(reasons).join(', ');
    const lastReadingAt = snapshot.anomalyWindow.lastSample ?? snapshot.aggregatedAt;

    flagged.push({
      partitionKey: snapshot.partitionKey,
      instrumentId: snapshot.instrumentId,
      reason,
      lastReadingAt,
      latestMetrics: snapshot.metrics
    });
  }

  return {
    flagged,
    totalPartitions: snapshots.length
  };
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: AlertsParameters;
  try {
    parameters = parseParameters(context.parameters);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message } satisfies JobRunResult;
  }

  let snapshots: TelemetrySnapshot[] = [];
  try {
    snapshots = await loadTelemetrySnapshots(parameters.telemetryDir, context.logger);
  } catch (err) {
    return {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err)
    } satisfies JobRunResult;
  }

  const latestSnapshots = selectLatestSnapshots(snapshots);
  const alertSummary = evaluateAlerts(latestSnapshots, parameters);

  await context.update({
    metrics: {
      partitions: alertSummary.totalPartitions,
      flagged: alertSummary.flagged.length
    }
  });

  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    windowHours: parameters.windowHours,
    temperatureLimitC: parameters.temperatureLimitC,
    humidityLimitPct: parameters.humidityLimitPct,
    totalPartitions: alertSummary.totalPartitions,
    flaggedInstruments: alertSummary.flagged
  };

  return {
    status: 'succeeded',
    result: {
      alerts: payload,
      assets: [
        {
          assetId: 'greenhouse.telemetry.alerts',
          producedAt: generatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
