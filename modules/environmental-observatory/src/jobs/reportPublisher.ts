import {
  createJobHandler,
  inheritModuleSettings,
  inheritModuleSecrets,
  selectFilestore,
  selectMetastore,
  sanitizeIdentifier,
  toTemporalKey,
  type FilestoreCapability,
  type JobContext
} from '@apphub/module-sdk';
import { z } from 'zod';
import { ensureFilestoreHierarchy, ensureResolvedBackendId, uploadTextFile } from '@apphub/module-sdk';
import { DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../runtime';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const visualizationArtifactSchema = z
  .object({
    path: z.string().min(1),
    nodeId: z.number().int().nullable().optional(),
    mediaType: z.string().min(1),
    description: z.string().optional(),
    sizeBytes: z.number().int().nullable().optional(),
    checksum: z.union([z.string().min(1), z.null()]).optional()
  })
  .strip();

const visualizationMetricsSchema = z
  .object({
    samples: z.number().int().nonnegative(),
    instrumentCount: z.number().int().nonnegative(),
    siteCount: z.number().int().nonnegative(),
    averageTemperatureC: z.number(),
    averagePm25: z.number(),
    maxPm25: z.number(),
    partitionKey: z.string().min(1),
    lookbackMinutes: z.number().int().positive(),
    siteFilter: z.string().optional(),
    instrumentId: z.string().optional(),
    partitionWindow: z.string().optional(),
    dataset: z.string().optional()
  })
  .strict();

const visualizationAssetSchema = z
  .object({
    generatedAt: z.string().min(1),
    partitionKey: z.string().min(1),
    storagePrefix: z.string().min(1),
    lookbackMinutes: z.number().int().positive(),
    partitionWindow: z.string().optional(),
    dataset: z.union([z.string().min(1), z.null()]).optional(),
    artifacts: z.array(visualizationArtifactSchema),
    metrics: visualizationMetricsSchema
  })
  .strict();

const parametersSchema = z
  .object({
    reportsPrefix: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => {
        if (value == null) {
          return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }),
    partitionKey: z.string().min(1),
    instrumentId: z.string().min(1).optional(),
    reportTemplate: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => {
        if (value == null) {
          return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }),
    visualizationAsset: visualizationAssetSchema
  })
  .strip();

export type ReportPublisherParameters = z.infer<typeof parametersSchema>;

type ReportPublisherContext = JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  ReportPublisherParameters
>;

type VisualizationArtifact = z.infer<typeof visualizationArtifactSchema>;
type VisualizationMetrics = z.infer<typeof visualizationMetricsSchema>;

type ReportFile = {
  path: string;
  nodeId: number | null;
  mediaType: string;
  sizeBytes: number | null;
  checksum: string | null;
};

type ReportAssetPayload = {
  generatedAt: string;
  storagePrefix: string;
  reportFiles: ReportFile[];
  summary: {
    instrumentCount: number;
    siteCount: number;
    alertCount: number;
  };
  plotsReferenced: Array<{ path: string; altText: string }>;
  instrumentId?: string;
};

type ReportPublisherResult = {
  partitionKey: string;
  report: ReportAssetPayload;
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: ReportAssetPayload;
  }>;
};

function sanitizeRecordKey(key: string): string {
  return sanitizeIdentifier(key) || 'report';
}

function buildMarkdown(metrics: VisualizationMetrics, artifacts: VisualizationArtifact[]): string {
  const chartList = artifacts
    .filter((artifact) => artifact.mediaType.startsWith('image/'))
    .map((artifact) => `- ![${artifact.description ?? artifact.path}](${artifact.path})`)
    .join('\n');

  const instrumentLine = metrics.instrumentId ? `- Instrument source: **${metrics.instrumentId}**\n` : '';

  return `# Observatory Status Report (${metrics.partitionKey})

- Samples analysed: **${metrics.samples}**
- Instruments reporting: **${metrics.instrumentCount}**
- Sites covered: **${metrics.siteCount}**
- Average temperature: **${metrics.averageTemperatureC.toFixed(2)} °C**
- Average PM2.5: **${metrics.averagePm25.toFixed(2)} µg/m³**
- Peak PM2.5: **${metrics.maxPm25.toFixed(2)} µg/m³**
${instrumentLine}

${chartList || '_No charts generated for this window._'}
`;
}

function buildHtml(template: string | undefined, markdownContent: string, metrics: VisualizationMetrics): string {
  const defaultTemplate = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Observatory Status Report - ${metrics.partitionKey}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 2rem; background-color: #0c111b; color: #f5f7fa; }
      h1 { color: #5bd1ff; }
      img { max-width: 100%; margin: 1rem 0; border-radius: 4px; }
      a { color: #ff9f1c; }
      .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
      .summary div { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; }
      .summary strong { display: block; font-size: 1.8rem; color: #ffffff; }
      pre { background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 6px; overflow: auto; }
    </style>
  </head>
  <body>
    <header>
      <h1>Observatory Status Report</h1>
      <p>Window ${metrics.partitionKey} · Lookback ${metrics.lookbackMinutes} minutes${metrics.siteFilter ? ` · Site ${metrics.siteFilter}` : ''}</p>
    </header>
    <main>
      <section class="summary">
        ${metrics.instrumentId ? `<div><span>Instrument</span><strong>${metrics.instrumentId}</strong></div>` : ''}
        <div>
          <span>Samples analysed</span>
          <strong>${metrics.samples}</strong>
        </div>
        <div>
          <span>Instruments reporting</span>
          <strong>${metrics.instrumentCount}</strong>
        </div>
        <div>
          <span>Sites covered</span>
          <strong>${metrics.siteCount}</strong>
        </div>
        <div>
          <span>Average temperature</span>
          <strong>${metrics.averageTemperatureC.toFixed(2)} °C</strong>
        </div>
        <div>
          <span>Average PM2.5</span>
          <strong>${metrics.averagePm25.toFixed(2)} µg/m³</strong>
        </div>
        <div>
          <span>Peak PM2.5</span>
          <strong>${metrics.maxPm25.toFixed(2)} µg/m³</strong>
        </div>
      </section>
      <section>
        ${markdownContent
          .split('\n')
          .map((line) => (line.startsWith('- ') ? `<p>${line.slice(2)}</p>` : `<p>${line}</p>`))
          .join('\n')}
      </section>
    </main>
  </body>
</html>`;

  if (!template) {
    return defaultTemplate;
  }

  return template
    .replace('{{partitionKey}}', metrics.partitionKey)
    .replace('{{lookbackMinutes}}', String(metrics.lookbackMinutes))
    .replace('{{siteFilter}}', metrics.siteFilter ?? '')
    .replace('{{markdown}}', markdownContent);
}

function buildSummary(metrics: VisualizationMetrics): ReportAssetPayload['summary'] {
  return {
    instrumentCount: metrics.instrumentCount,
    siteCount: metrics.siteCount,
    alertCount: metrics.maxPm25 > 35 ? 1 : 0
  } satisfies ReportAssetPayload['summary'];
}

function buildPlotsReferenced(artifacts: VisualizationArtifact[]): Array<{ path: string; altText: string }> {
  return artifacts
    .filter((artifact) => artifact.mediaType.startsWith('image/'))
    .map((artifact) => ({
      path: artifact.path,
      altText: artifact.description ?? artifact.path
    }));
}

function normalizeReportsPrefix(parameters: ReportPublisherParameters, settings: ObservatoryModuleSettings): string {
  const explicit = parameters.reportsPrefix?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/g, '');
  }
  return settings.filestore.reportsPrefix.replace(/\/+$/g, '');
}

export const reportPublisherJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  ReportPublisherResult,
  ReportPublisherParameters,
  ['filestore', 'metastore.reports']
>({
  name: 'observatory-report-publisher',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'metastore.reports'] as const,
  parameters: {
    resolve: (raw) => parametersSchema.parse(raw ?? {})
  },
  handler: async (context: ReportPublisherContext): Promise<ReportPublisherResult> => {
    const filestoreCapabilityCandidate = selectFilestore(context.capabilities);
    if (!filestoreCapabilityCandidate) {
      throw new Error('Filestore capability is required for the report publisher');
    }
    const filestore: FilestoreCapability = filestoreCapabilityCandidate;
    const metastore = selectMetastore(context.capabilities, 'reports');

    const principal = context.settings.principals.dashboardAggregator?.trim() || undefined;
    const backendMountId = await ensureResolvedBackendId(filestore, {
      filestoreBackendId: context.settings.filestore.backendId,
      filestoreBackendKey: context.settings.filestore.backendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
    });

    const reportsPrefix = normalizeReportsPrefix(context.parameters, context.settings);
    const metrics = context.parameters.visualizationAsset.metrics;
    const markdown = buildMarkdown(metrics, context.parameters.visualizationAsset.artifacts);
    const html = buildHtml(context.parameters.reportTemplate, markdown, metrics);
    const summary = buildSummary(metrics);
    const plotsReferenced = buildPlotsReferenced(context.parameters.visualizationAsset.artifacts);
    const generatedAt = new Date().toISOString();

    const instrumentSegment =
      sanitizeIdentifier(context.parameters.instrumentId ?? metrics.instrumentId ?? 'all') || 'all';
    const partitionSegment =
      toTemporalKey(context.parameters.partitionKey) || sanitizeIdentifier(context.parameters.partitionKey) || 'window';
    const storagePrefix = `${reportsPrefix}/${instrumentSegment}/${partitionSegment}`.replace(/\/+$/g, '');

    await ensureFilestoreHierarchy(filestore, backendMountId, storagePrefix, principal);

    const markdownNode = await uploadTextFile({
      filestore,
      backendMountId,
      path: `${storagePrefix}/status.md`,
      content: markdown,
      contentType: 'text/markdown; charset=utf-8',
      principal,
      metadata: {
        partitionKey: context.parameters.partitionKey,
        instrumentId: context.parameters.instrumentId ?? null,
        variant: 'status-markdown'
      }
    });

    const htmlNode = await uploadTextFile({
      filestore,
      backendMountId,
      path: `${storagePrefix}/status.html`,
      content: html,
      contentType: 'text/html; charset=utf-8',
      principal,
      metadata: {
        partitionKey: context.parameters.partitionKey,
        instrumentId: context.parameters.instrumentId ?? null,
        variant: 'status-html'
      }
    });

    const summaryJson = {
      generatedAt,
      storagePrefix,
      partitionKey: context.parameters.partitionKey,
      instrumentId: context.parameters.instrumentId ?? metrics.instrumentId ?? null,
      lookbackMinutes: context.parameters.visualizationAsset.lookbackMinutes,
      siteFilter: metrics.siteFilter ?? null,
      summary,
      metrics,
      plotsReferenced,
      visualization: {
        storagePrefix: context.parameters.visualizationAsset.storagePrefix,
        artifacts: context.parameters.visualizationAsset.artifacts
      },
      reports: [markdownNode, htmlNode].map((node) => ({
        path: node.path,
        nodeId: node.node?.id ?? node.nodeId ?? null,
        mediaType: node.path.endsWith('.md')
          ? 'text/markdown'
          : node.path.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream',
        sizeBytes: node.node?.sizeBytes ?? null,
        checksum: node.node?.checksum ?? null
      }))
    } satisfies Record<string, unknown>;

    const jsonNode = await uploadTextFile({
      filestore,
      backendMountId,
      path: `${storagePrefix}/status.json`,
      content: JSON.stringify(summaryJson, null, 2),
      contentType: 'application/json',
      principal,
      metadata: {
        partitionKey: context.parameters.partitionKey,
        instrumentId: context.parameters.instrumentId ?? null,
        variant: 'status-json'
      }
    });

    const reportFiles: ReportFile[] = [
      {
        path: markdownNode.path,
        nodeId: markdownNode.node?.id ?? markdownNode.nodeId ?? null,
        mediaType: 'text/markdown',
        sizeBytes: markdownNode.node?.sizeBytes ?? null,
        checksum: markdownNode.node?.checksum ?? null
      },
      {
        path: htmlNode.path,
        nodeId: htmlNode.node?.id ?? htmlNode.nodeId ?? null,
        mediaType: 'text/html',
        sizeBytes: htmlNode.node?.sizeBytes ?? null,
        checksum: htmlNode.node?.checksum ?? null
      },
      {
        path: jsonNode.path,
        nodeId: jsonNode.node?.id ?? jsonNode.nodeId ?? null,
        mediaType: 'application/json',
        sizeBytes: jsonNode.node?.sizeBytes ?? null,
        checksum: jsonNode.node?.checksum ?? null
      }
    ];

    const assetPartitionKey = context.parameters.instrumentId
      ? `${context.parameters.instrumentId}::${context.parameters.partitionKey}`
      : context.parameters.partitionKey;

    const payload: ReportAssetPayload = {
      generatedAt,
      storagePrefix,
      reportFiles,
      summary,
      plotsReferenced,
      instrumentId: context.parameters.instrumentId ?? metrics.instrumentId ?? undefined
    } satisfies ReportAssetPayload;

    if (metastore) {
      const recordKey = sanitizeRecordKey(assetPartitionKey);
      await metastore.upsertRecord({
        key: recordKey,
        principal,
        metadata: {
          partitionKey: context.parameters.partitionKey,
          instrumentId: context.parameters.instrumentId ?? metrics.instrumentId ?? null,
          generatedAt,
          storagePrefix,
          summary,
          plotsReferenced,
          reportFiles,
          visualizationPartition: context.parameters.visualizationAsset.partitionKey,
          visualizationMetrics: metrics,
          lookbackMinutes: context.parameters.visualizationAsset.lookbackMinutes,
          siteFilter: metrics.siteFilter ?? null
        }
      });
    }

    context.logger.info('Published observatory status report', {
      partitionKey: context.parameters.partitionKey,
      instrumentId: context.parameters.instrumentId ?? null,
      storagePrefix
    });

    return {
      partitionKey: assetPartitionKey,
      report: payload,
      assets: [
        {
          assetId: 'observatory.reports.status',
          partitionKey: assetPartitionKey,
          producedAt: generatedAt,
          payload
        }
      ]
    } satisfies ReportPublisherResult;
  }
});
