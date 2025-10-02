import { createJobHandler, type JobContext } from '@apphub/module-sdk';
import { z } from 'zod';
import {
  ensureFilestoreHierarchy,
  ensureResolvedBackendId,
  uploadTextFile
} from '../runtime/filestore';
import { defaultObservatorySettings, type ObservatoryModuleSecrets, type ObservatoryModuleSettings } from '../runtime/settings';

const MAX_ROWS = 10_000;

const parametersSchema = z
  .object({
    partitionKey: z.string().min(1, 'partitionKey is required'),
    partitionWindow: z.string().min(1).optional(),
    lookbackMinutes: z
      .union([z.number().int().positive().max(24 * 60), z.null(), z.undefined()])
      .transform((value) => (value == null ? undefined : value)),
    instrumentId: z.string().min(1).optional(),
    siteFilter: z
      .union([z.string().min(1), z.null(), z.undefined()])
      .transform((value) => (value == null ? undefined : value)),
    datasetSlug: z.string().min(1).optional(),
    datasetName: z.string().min(1).optional()
  })
  .strip();

export type VisualizationRunnerParameters = z.infer<typeof parametersSchema>;

type VisualizationRunnerContext = JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  VisualizationRunnerParameters
>;

type ObservatoryRow = {
  timestamp: string;
  instrument_id: string;
  site: string;
  temperature_c: number;
  relative_humidity_pct: number;
  pm2_5_ug_m3: number;
  battery_voltage: number;
};

type TrendRow = {
  minuteKey: string;
  avgTemperature: number;
  avgPm25: number;
  avgHumidity: number;
  avgBattery: number;
  samples: number;
};

type VisualizationMetrics = {
  samples: number;
  instrumentCount: number;
  siteCount: number;
  averageTemperatureC: number;
  averagePm25: number;
  maxPm25: number;
  partitionKey: string;
  partitionWindow: string;
  lookbackMinutes: number;
  siteFilter?: string;
  instrumentId?: string;
  dataset?: string;
};

type VisualizationArtifact = {
  path: string;
  nodeId: number | null;
  mediaType: string;
  description: string;
  sizeBytes: number | null;
  checksum: string | null;
};

type VisualizationResult = {
  partitionKey: string;
  partitionWindow: string;
  dataset: string | null;
  visualization: {
    generatedAt: string;
    partitionKey: string;
    partitionWindow: string;
    storagePrefix: string;
    lookbackMinutes: number;
    artifacts: VisualizationArtifact[];
    metrics: VisualizationMetrics;
  };
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: VisualizationResult['visualization'];
  }>;
};

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toIsoMinute(partitionKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(partitionKey)) {
    return `${partitionKey}:00Z`;
  }
  return partitionKey;
}

function computeTimeRange(partitionWindow: string, lookbackMinutes: number): { startIso: string; endIso: string } {
  const endIso = toIsoMinute(partitionWindow);
  const endDate = new Date(endIso);
  if (Number.isNaN(endDate.getTime())) {
    throw new Error(`Invalid partition window '${partitionWindow}', expected format YYYY-MM-DDTHH:mm`);
  }
  const startDate = new Date(endDate.getTime() - (lookbackMinutes - 1) * 60_000);
  const startIso = startDate.toISOString().slice(0, 19) + 'Z';
  const endWithWindow = new Date(endDate.getTime() + 59_000 + 999);
  const normalizedEndIso = endWithWindow.toISOString().slice(0, 23) + 'Z';
  return { startIso, endIso: normalizedEndIso };
}

function parseCompositePartitionKey(partitionKey: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!partitionKey.includes('=')) {
    return map;
  }
  for (const segment of partitionKey.split('|')) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!key || rest.length === 0) {
      continue;
    }
    const normalizedKey = key.trim().toLowerCase();
    const normalizedValue = rest.join('=').trim();
    if (normalizedKey && normalizedValue) {
      map.set(normalizedKey, normalizedValue);
    }
  }
  return map;
}

function resolvePartitionWindow(parameters: VisualizationRunnerParameters): {
  partitionWindow: string;
  instrumentId?: string;
  dataset?: string;
} {
  const map = parseCompositePartitionKey(parameters.partitionKey);
  const window = parameters.partitionWindow || map.get('window') || map.get('minute');
  if (!window) {
    throw new Error('partitionWindow is required to build the visualization');
  }
  return {
    partitionWindow: window,
    instrumentId: parameters.instrumentId ?? map.get('instrument') ?? map.get('instrument_id') ?? undefined,
    dataset: parameters.datasetSlug ?? parameters.datasetName ?? map.get('dataset') ?? undefined
  };
}

function bucketObservations(rows: ObservatoryRow[]): TrendRow[] {
  const buckets = new Map<string, { sumTemp: number; sumPm25: number; sumHumidity: number; sumBattery: number; count: number }>();
  for (const row of rows) {
    const minuteKey = row.timestamp.slice(0, 16);
    const bucket = buckets.get(minuteKey) ?? { sumTemp: 0, sumPm25: 0, sumHumidity: 0, sumBattery: 0, count: 0 };
    bucket.sumTemp += row.temperature_c;
    bucket.sumPm25 += row.pm2_5_ug_m3;
    bucket.sumHumidity += row.relative_humidity_pct;
    bucket.sumBattery += row.battery_voltage;
    bucket.count += 1;
    buckets.set(minuteKey, bucket);
  }

  return Array.from(buckets.entries())
    .map(([minuteKey, bucket]) => ({
      minuteKey,
      avgTemperature: bucket.count ? bucket.sumTemp / bucket.count : 0,
      avgPm25: bucket.count ? bucket.sumPm25 / bucket.count : 0,
      avgHumidity: bucket.count ? bucket.sumHumidity / bucket.count : 0,
      avgBattery: bucket.count ? bucket.sumBattery / bucket.count : 0,
      samples: bucket.count
    }))
    .sort((a, b) => a.minuteKey.localeCompare(b.minuteKey));
}

type ObservationSummary = {
  samples: number;
  instrumentCount: number;
  siteCount: number;
  averageTemperatureC: number;
  averagePm25: number;
  maxPm25: number;
};

function summarizeObservations(rows: ObservatoryRow[]): ObservationSummary {
  if (!rows.length) {
    return {
      samples: 0,
      instrumentCount: 0,
      siteCount: 0,
      averageTemperatureC: 0,
      averagePm25: 0,
      maxPm25: 0
    } satisfies ObservationSummary;
  }

  const instruments = new Set<string>();
  const sites = new Set<string>();
  let totalTemp = 0;
  let totalPm25 = 0;
  let maxPm25 = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    totalTemp += row.temperature_c;
    totalPm25 += row.pm2_5_ug_m3;
    instruments.add(row.instrument_id);
    if (row.site) {
      sites.add(row.site);
    }
    if (row.pm2_5_ug_m3 > maxPm25) {
      maxPm25 = row.pm2_5_ug_m3;
    }
  }

  return {
    samples: rows.length,
    instrumentCount: instruments.size,
    siteCount: sites.size,
    averageTemperatureC: rows.length ? totalTemp / rows.length : 0,
    averagePm25: rows.length ? totalPm25 / rows.length : 0,
    maxPm25
  } satisfies ObservationSummary;
}

function buildTrendPath(rows: TrendRow[], accessor: (row: TrendRow) => number): string {
  if (rows.length === 0) {
    return '';
  }
  const values = rows.map(accessor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 640;
  const height = 240;
  const horizontalStep = width / Math.max(rows.length - 1, 1);

  return rows
    .map((row, index) => {
      const x = index * horizontalStep;
      const normalized = (accessor(row) - min) / range;
      const y = height - normalized * (height - 40) - 20;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function temperatureSvg(rows: TrendRow[]): string {
  const pathData = buildTrendPath(rows, (row) => row.avgTemperature);
  if (!pathData) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="18">No data available</text></svg>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">
  <rect width="640" height="240" fill="#0b1526" />
  <path d="${pathData}" fill="none" stroke="#4fc3f7" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
  <text x="20" y="30" fill="#ffffff" font-family="sans-serif" font-size="16">Average temperature (°C)</text>
</svg>`;
}

function pm25Svg(rows: TrendRow[]): string {
  const pathData = buildTrendPath(rows, (row) => row.avgPm25);
  if (!pathData) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="18">No data available</text></svg>';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">
  <rect width="640" height="240" fill="#1b0b2a" />
  <path d="${pathData}" fill="none" stroke="#ff9f1c" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
  <text x="20" y="30" fill="#ffffff" font-family="sans-serif" font-size="16">Average PM2.5 (µg/m³)</text>
</svg>`;
}

function filterRows(
  rows: ObservatoryRow[],
  parameters: VisualizationRunnerParameters & { instrumentId?: string; siteFilter?: string }
): ObservatoryRow[] {
  let filtered = rows;
  if (parameters.instrumentId) {
    const filterValue = parameters.instrumentId.toLowerCase();
    filtered = filtered.filter((row) => row.instrument_id.toLowerCase() === filterValue);
  }
  if (parameters.siteFilter) {
    const filterValue = parameters.siteFilter.toLowerCase();
    filtered = filtered.filter((row) => row.site.toLowerCase() === filterValue);
  }
  return filtered;
}

export const visualizationRunnerJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  VisualizationResult,
  VisualizationRunnerParameters
>({
  name: 'observatory-visualization-runner',
  settings: {
    defaults: defaultObservatorySettings
  },
  parameters: {
    resolve: (raw) => parametersSchema.parse(raw ?? {})
  },
  handler: async (context: VisualizationRunnerContext): Promise<VisualizationResult> => {
    const filestore = context.capabilities.filestore;
    const timestore = context.capabilities.timestore;
    if (!filestore) {
      throw new Error('Filestore capability is required for the visualization runner job');
    }
    if (!timestore) {
      throw new Error('Timestore capability is required for the visualization runner job');
    }

    const principal = context.settings.principals.visualizationRunner?.trim() || undefined;
    const defaults = resolvePartitionWindow(context.parameters);
    const partitionWindow = defaults.partitionWindow;

    const lookbackMinutes = context.parameters.lookbackMinutes ?? context.settings.dashboard.lookbackMinutes;
    const datasetSlug = context.parameters.datasetSlug ?? context.settings.timestore.datasetSlug;
    const datasetName = context.parameters.datasetName ?? context.settings.timestore.datasetName;

    const backendParameters = {
      filestoreBackendId: context.settings.filestore.backendId,
      filestoreBackendKey: context.settings.filestore.backendKey
    } satisfies {
      filestoreBackendId?: number | null;
      filestoreBackendKey?: string | null;
    };
    const backendMountId = await ensureResolvedBackendId(filestore, backendParameters);

    const { startIso, endIso } = computeTimeRange(partitionWindow, lookbackMinutes);

    const queryResult = await timestore.queryDataset({
      datasetSlug,
      timeRange: { start: startIso, end: endIso },
      timestampColumn: 'timestamp',
      columns: [
        'timestamp',
        'instrument_id',
        'site',
        'temperature_c',
        'relative_humidity_pct',
        'pm2_5_ug_m3',
        'battery_voltage'
      ],
      limit: MAX_ROWS,
      principal,
      filters: context.parameters.instrumentId
        ? { instrument_id: context.parameters.instrumentId }
        : undefined
    });

    const rows: ObservatoryRow[] = (queryResult.rows ?? []).flatMap((row) => {
      if (!row) {
        return [];
      }
      const timestamp = ensureString((row as Record<string, unknown>).timestamp ?? '');
      if (!timestamp) {
        return [];
      }
      const parsed = new Date(timestamp);
      if (Number.isNaN(parsed.getTime())) {
        return [];
      }

      return [
        {
          timestamp: parsed.toISOString(),
          instrument_id: ensureString((row as Record<string, unknown>).instrument_id ?? ''),
          site: ensureString((row as Record<string, unknown>).site ?? ''),
          temperature_c: Number((row as Record<string, unknown>).temperature_c ?? 0),
          relative_humidity_pct: Number((row as Record<string, unknown>).relative_humidity_pct ?? 0),
          pm2_5_ug_m3: Number((row as Record<string, unknown>).pm2_5_ug_m3 ?? 0),
          battery_voltage: Number((row as Record<string, unknown>).battery_voltage ?? 0)
        }
      ];
    });

    const filteredRows = filterRows(rows, {
      ...context.parameters,
      instrumentId: context.parameters.instrumentId ?? defaults.instrumentId,
      datasetSlug
    });
    const trendRows = bucketObservations(filteredRows);
    const stats = summarizeObservations(filteredRows);
    const metrics: VisualizationMetrics = {
      samples: stats.samples,
      instrumentCount: stats.instrumentCount,
      siteCount: stats.siteCount,
      averageTemperatureC: stats.averageTemperatureC,
      averagePm25: stats.averagePm25,
      maxPm25: stats.maxPm25,
      partitionKey: context.parameters.partitionKey,
      partitionWindow,
      lookbackMinutes,
      siteFilter: context.parameters.siteFilter ?? undefined,
      instrumentId: context.parameters.instrumentId ?? defaults.instrumentId ?? undefined,
      dataset: context.parameters.datasetSlug ?? defaults.dataset ?? datasetSlug
    } satisfies VisualizationMetrics;

    const generatedAt = new Date().toISOString();

    const visualizationPrefix = context.settings.filestore.visualizationsPrefix.replace(/\/+$/g, '');
    const datasetKey = (metrics.dataset ?? 'dataset').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'dataset';
    const instrumentKey = (metrics.instrumentId ?? 'all').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'all';
    const partitionKeySafe = partitionWindow.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '') || 'window';
    const storagePrefix = `${visualizationPrefix}/${datasetKey}/${instrumentKey}/${partitionKeySafe}`;

    await ensureFilestoreHierarchy(filestore, backendMountId, storagePrefix, principal);

    const temperatureContent = temperatureSvg(trendRows);
    const pm25Content = pm25Svg(trendRows);

    const temperatureNode = await uploadTextFile({
      filestore,
      backendMountId,
      path: `${storagePrefix}/temperature_trend.svg`,
      content: temperatureContent,
      contentType: 'image/svg+xml',
      principal,
      metadata: {
        partitionKey: context.parameters.partitionKey,
        partitionWindow,
        instrumentId: metrics.instrumentId ?? null,
        siteFilter: metrics.siteFilter ?? null,
        dataset: metrics.dataset ?? null,
        variant: 'temperature'
      }
    });

    const pm25Node = await uploadTextFile({
      filestore,
      backendMountId,
      path: `${storagePrefix}/pm25_trend.svg`,
      content: pm25Content,
      contentType: 'image/svg+xml',
      principal,
      metadata: {
        partitionKey: context.parameters.partitionKey,
        partitionWindow,
        instrumentId: metrics.instrumentId ?? null,
        siteFilter: metrics.siteFilter ?? null,
        dataset: metrics.dataset ?? null,
        variant: 'pm25'
      }
    });

    const metricsNode = await uploadTextFile({
      filestore,
      backendMountId,
      path: `${storagePrefix}/metrics.json`,
      content: JSON.stringify(metrics, null, 2),
      contentType: 'application/json',
      principal,
      metadata: {
        partitionKey: context.parameters.partitionKey,
        partitionWindow,
        instrumentId: metrics.instrumentId ?? null,
        siteFilter: metrics.siteFilter ?? null,
        dataset: metrics.dataset ?? null,
        variant: 'metrics'
      }
    });

    const artifacts: VisualizationArtifact[] = [
      {
        path: temperatureNode.path,
        nodeId: temperatureNode.node?.id ?? temperatureNode.nodeId ?? null,
        mediaType: 'image/svg+xml',
        description: 'Average temperature trend',
        sizeBytes: temperatureNode.node?.sizeBytes ?? null,
        checksum: temperatureNode.node?.checksum ?? null
      },
      {
        path: pm25Node.path,
        nodeId: pm25Node.node?.id ?? pm25Node.nodeId ?? null,
        mediaType: 'image/svg+xml',
        description: 'Average PM2.5 trend',
        sizeBytes: pm25Node.node?.sizeBytes ?? null,
        checksum: pm25Node.node?.checksum ?? null
      },
      {
        path: metricsNode.path,
        nodeId: metricsNode.node?.id ?? metricsNode.nodeId ?? null,
        mediaType: 'application/json',
        description: 'Visualization metrics JSON',
        sizeBytes: metricsNode.node?.sizeBytes ?? null,
        checksum: metricsNode.node?.checksum ?? null
      }
    ];

    const visualization = {
      generatedAt,
      partitionKey: context.parameters.partitionKey,
      partitionWindow,
      storagePrefix,
      lookbackMinutes,
      artifacts,
      metrics
    } satisfies VisualizationResult['visualization'];

    return {
      partitionKey: context.parameters.partitionKey,
      partitionWindow,
      dataset: metrics.dataset ?? null,
      visualization,
      assets: [
        {
          assetId: 'observatory.visualizations.minute',
          partitionKey: context.parameters.partitionKey,
          producedAt: generatedAt,
          payload: visualization
        }
      ]
    } satisfies VisualizationResult;
  }
});
