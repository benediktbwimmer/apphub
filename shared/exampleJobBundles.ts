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
  'file-relocator': { directory: 'job-bundles/file-relocator' },
  'retail-sales-csv-loader': { directory: 'job-bundles/retail-sales-csv-loader' },
  'retail-sales-parquet-builder': { directory: 'job-bundles/retail-sales-parquet-builder' },
  'retail-sales-visualizer': { directory: 'job-bundles/retail-sales-visualizer' },
  'fleet-telemetry-metrics': { directory: 'job-bundles/fleet-telemetry-metrics' },
  'greenhouse-alerts-runner': { directory: 'job-bundles/greenhouse-alerts-runner' },
  'archive-report': { directory: 'job-bundles/archive-report' },
  'generate-visualizations': { directory: 'job-bundles/generate-visualizations' },
  'scan-directory': { directory: 'job-bundles/scan-directory' },
  'observatory-inbox-normalizer': { directory: 'job-bundles/observatory-inbox-normalizer' },
  'observatory-duckdb-loader': { directory: 'job-bundles/observatory-duckdb-loader' },
  'observatory-visualization-runner': { directory: 'job-bundles/observatory-visualization-runner' },
  'observatory-report-publisher': { directory: 'job-bundles/observatory-report-publisher' }
};
