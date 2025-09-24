export type ExampleJobBundleSlug =
  | 'file-relocator'
  | 'retail-sales-csv-loader'
  | 'retail-sales-parquet-builder'
  | 'retail-sales-visualizer'
  | 'fleet-telemetry-metrics'
  | 'greenhouse-alerts-runner'
  | 'archive-report'
  | 'generate-visualizations'
  | 'scan-directory'
  | 'observatory-inbox-normalizer'
  | 'observatory-duckdb-loader'
  | 'observatory-visualization-runner'
  | 'observatory-report-publisher';

export type ExampleJobBundleDefinition = {
  /**
   * Relative path to the bundle directory from the repository root.
   */
  directory: string;
};

export const EXAMPLE_JOB_BUNDLES: Record<ExampleJobBundleSlug, ExampleJobBundleDefinition> = {
  'file-relocator': { directory: 'examples/file-drop/jobs/file-relocator' },
  'retail-sales-csv-loader': { directory: 'examples/retail-sales/jobs/retail-sales-csv-loader' },
  'retail-sales-parquet-builder': { directory: 'examples/retail-sales/jobs/retail-sales-parquet-builder' },
  'retail-sales-visualizer': { directory: 'examples/retail-sales/jobs/retail-sales-visualizer' },
  'fleet-telemetry-metrics': { directory: 'examples/fleet-telemetry/jobs/fleet-telemetry-metrics' },
  'greenhouse-alerts-runner': { directory: 'examples/fleet-telemetry/jobs/greenhouse-alerts-runner' },
  'archive-report': { directory: 'examples/directory-insights/jobs/archive-report' },
  'generate-visualizations': { directory: 'examples/directory-insights/jobs/generate-visualizations' },
  'scan-directory': { directory: 'examples/directory-insights/jobs/scan-directory' },
  'observatory-inbox-normalizer': { directory: 'examples/environmental-observatory/jobs/observatory-inbox-normalizer' },
  'observatory-duckdb-loader': { directory: 'examples/environmental-observatory/jobs/observatory-duckdb-loader' },
  'observatory-visualization-runner': { directory: 'examples/environmental-observatory/jobs/observatory-visualization-runner' },
  'observatory-report-publisher': { directory: 'examples/environmental-observatory/jobs/observatory-report-publisher' }
};
