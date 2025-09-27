import type {
  ExampleJobBundle,
  ExampleJobSlug,
  JobDefinitionTemplate,
  JobManifestTemplate
} from './types';

import fileRelocatorManifestJson from '../../../examples/file-drop/jobs/file-relocator/manifest.json';
import fileRelocatorDefinitionJson from '../../../examples/file-drop/jobs/file-relocator/job-definition.json';
import retailSalesCsvLoaderManifestJson from '../../../examples/retail-sales/jobs/retail-sales-csv-loader/manifest.json';
import retailSalesCsvLoaderDefinitionJson from '../../../examples/retail-sales/jobs/retail-sales-csv-loader/job-definition.json';
import retailSalesParquetBuilderManifestJson from '../../../examples/retail-sales/jobs/retail-sales-parquet-builder/manifest.json';
import retailSalesParquetBuilderDefinitionJson from '../../../examples/retail-sales/jobs/retail-sales-parquet-builder/job-definition.json';
import retailSalesVisualizerManifestJson from '../../../examples/retail-sales/jobs/retail-sales-visualizer/manifest.json';
import retailSalesVisualizerDefinitionJson from '../../../examples/retail-sales/jobs/retail-sales-visualizer/job-definition.json';
import fleetTelemetryMetricsManifestJson from '../../../examples/fleet-telemetry/jobs/fleet-telemetry-metrics/manifest.json';
import fleetTelemetryMetricsDefinitionJson from '../../../examples/fleet-telemetry/jobs/fleet-telemetry-metrics/job-definition.json';
import greenhouseAlertsRunnerManifestJson from '../../../examples/fleet-telemetry/jobs/greenhouse-alerts-runner/manifest.json';
import greenhouseAlertsRunnerDefinitionJson from '../../../examples/fleet-telemetry/jobs/greenhouse-alerts-runner/job-definition.json';
import observatoryDataGeneratorManifestJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-data-generator/manifest.json';
import observatoryDataGeneratorDefinitionJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-data-generator/job-definition.json';
import observatoryInboxNormalizerManifestJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-inbox-normalizer/manifest.json';
import observatoryInboxNormalizerDefinitionJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-inbox-normalizer/job-definition.json';
import observatoryTimestoreLoaderManifestJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-timestore-loader/manifest.json';
import observatoryTimestoreLoaderDefinitionJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-timestore-loader/job-definition.json';
import observatoryVisualizationRunnerManifestJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-visualization-runner/manifest.json';
import observatoryVisualizationRunnerDefinitionJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-visualization-runner/job-definition.json';
import observatoryReportPublisherManifestJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-report-publisher/manifest.json';
import observatoryReportPublisherDefinitionJson from '../../../examples/environmental-observatory-event-driven/jobs/observatory-report-publisher/job-definition.json';
import scanDirectoryManifestJson from '../../../examples/directory-insights/jobs/scan-directory/manifest.json';
import scanDirectoryDefinitionJson from '../../../examples/directory-insights/jobs/scan-directory/job-definition.json';
import generateVisualizationsManifestJson from '../../../examples/directory-insights/jobs/generate-visualizations/manifest.json';
import generateVisualizationsDefinitionJson from '../../../examples/directory-insights/jobs/generate-visualizations/job-definition.json';
import archiveReportManifestJson from '../../../examples/directory-insights/jobs/archive-report/manifest.json';
import archiveReportDefinitionJson from '../../../examples/directory-insights/jobs/archive-report/job-definition.json';

function manifest(json: unknown): JobManifestTemplate {
  return json as JobManifestTemplate;
}

function jobDefinition(json: unknown): JobDefinitionTemplate {
  return json as JobDefinitionTemplate;
}

function createJobBundle(params: {
  slug: ExampleJobSlug;
  directory: string;
  manifestJson: unknown;
  definitionJson: unknown;
}): ExampleJobBundle {
  const manifestData = manifest(params.manifestJson);
  return {
    slug: params.slug,
    version: manifestData.version,
    directory: params.directory,
    manifestPath: `${params.directory}/manifest.json`,
    jobDefinitionPath: `${params.directory}/job-definition.json`,
    manifest: manifestData,
    definition: jobDefinition(params.definitionJson)
  };
}

export const EXAMPLE_JOB_BUNDLES: ReadonlyArray<ExampleJobBundle> = [
  createJobBundle({
    slug: 'file-relocator',
    directory: 'examples/file-drop/jobs/file-relocator',
    manifestJson: fileRelocatorManifestJson,
    definitionJson: fileRelocatorDefinitionJson
  }),
  createJobBundle({
    slug: 'retail-sales-csv-loader',
    directory: 'examples/retail-sales/jobs/retail-sales-csv-loader',
    manifestJson: retailSalesCsvLoaderManifestJson,
    definitionJson: retailSalesCsvLoaderDefinitionJson
  }),
  createJobBundle({
    slug: 'retail-sales-parquet-builder',
    directory: 'examples/retail-sales/jobs/retail-sales-parquet-builder',
    manifestJson: retailSalesParquetBuilderManifestJson,
    definitionJson: retailSalesParquetBuilderDefinitionJson
  }),
  createJobBundle({
    slug: 'retail-sales-visualizer',
    directory: 'examples/retail-sales/jobs/retail-sales-visualizer',
    manifestJson: retailSalesVisualizerManifestJson,
    definitionJson: retailSalesVisualizerDefinitionJson
  }),
  createJobBundle({
    slug: 'fleet-telemetry-metrics',
    directory: 'examples/fleet-telemetry/jobs/fleet-telemetry-metrics',
    manifestJson: fleetTelemetryMetricsManifestJson,
    definitionJson: fleetTelemetryMetricsDefinitionJson
  }),
  createJobBundle({
    slug: 'greenhouse-alerts-runner',
    directory: 'examples/fleet-telemetry/jobs/greenhouse-alerts-runner',
    manifestJson: greenhouseAlertsRunnerManifestJson,
    definitionJson: greenhouseAlertsRunnerDefinitionJson
  }),
  createJobBundle({
    slug: 'observatory-data-generator',
    directory: 'examples/environmental-observatory-event-driven/jobs/observatory-data-generator',
    manifestJson: observatoryDataGeneratorManifestJson,
    definitionJson: observatoryDataGeneratorDefinitionJson
  }),
  createJobBundle({
    slug: 'observatory-inbox-normalizer',
    directory: 'examples/environmental-observatory-event-driven/jobs/observatory-inbox-normalizer',
    manifestJson: observatoryInboxNormalizerManifestJson,
    definitionJson: observatoryInboxNormalizerDefinitionJson
  }),
  createJobBundle({
    slug: 'observatory-timestore-loader',
    directory: 'examples/environmental-observatory-event-driven/jobs/observatory-timestore-loader',
    manifestJson: observatoryTimestoreLoaderManifestJson,
    definitionJson: observatoryTimestoreLoaderDefinitionJson
  }),
  createJobBundle({
    slug: 'observatory-visualization-runner',
    directory: 'examples/environmental-observatory-event-driven/jobs/observatory-visualization-runner',
    manifestJson: observatoryVisualizationRunnerManifestJson,
    definitionJson: observatoryVisualizationRunnerDefinitionJson
  }),
  createJobBundle({
    slug: 'observatory-report-publisher',
    directory: 'examples/environmental-observatory-event-driven/jobs/observatory-report-publisher',
    manifestJson: observatoryReportPublisherManifestJson,
    definitionJson: observatoryReportPublisherDefinitionJson
  }),
  createJobBundle({
    slug: 'scan-directory',
    directory: 'examples/directory-insights/jobs/scan-directory',
    manifestJson: scanDirectoryManifestJson,
    definitionJson: scanDirectoryDefinitionJson
  }),
  createJobBundle({
    slug: 'generate-visualizations',
    directory: 'examples/directory-insights/jobs/generate-visualizations',
    manifestJson: generateVisualizationsManifestJson,
    definitionJson: generateVisualizationsDefinitionJson
  }),
  createJobBundle({
    slug: 'archive-report',
    directory: 'examples/directory-insights/jobs/archive-report',
    manifestJson: archiveReportManifestJson,
    definitionJson: archiveReportDefinitionJson
  })
] as const;

export const EXAMPLE_JOB_SLUGS = EXAMPLE_JOB_BUNDLES.map((bundle) => bundle.slug) as ReadonlyArray<ExampleJobSlug>;

const JOB_SLUG_SET = new Set(EXAMPLE_JOB_BUNDLES.map((bundle) => bundle.slug));

const JOB_BUNDLE_MAP: Record<ExampleJobSlug, ExampleJobBundle> = EXAMPLE_JOB_BUNDLES.reduce(
  (acc, bundle) => {
    acc[bundle.slug] = bundle;
    return acc;
  },
  {} as Record<ExampleJobSlug, ExampleJobBundle>
);

export function isExampleJobSlug(value: string): value is ExampleJobSlug {
  return JOB_SLUG_SET.has(value as ExampleJobSlug);
}

export function listExampleJobBundles(): ReadonlyArray<ExampleJobBundle> {
  return EXAMPLE_JOB_BUNDLES;
}

export function getExampleJobBundle(slug: ExampleJobSlug): ExampleJobBundle | undefined {
  return JOB_BUNDLE_MAP[slug];
}
