import type { ExampleScenario } from './types';

export const EXAMPLE_SCENARIOS: ExampleScenario[] = [
  {
    id: 'service-manifest-dev-stack',
    type: 'service-manifest',
    title: 'Dev stack service manifest',
    summary: 'Registers the local AppHub developer stack services from this repository.',
    description:
      'Imports the manifest at `services/service-manifest.json` to register the proxy, AI connector, and tagging services that ship with the repository. Useful when populating a fresh environment without hunting for URLs.',
    difficulty: 'beginner',
    tags: ['ready in dev', 'uses local services'],
    docs: [
      {
        label: 'Service manifests guide',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#service-manifests'
      }
    ],
    assets: [
      {
        label: 'services/service-manifest.json',
        path: 'services/service-manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/services/service-manifest.json'
      }
    ],
    form: {
      repo: 'https://github.com/benediktbwimmer/apphub.git',
      ref: 'main',
      configPath: 'services/service-manifest.json',
      module: 'apphub-dev-stack'
    },
    analyticsTag: 'service_manifest__dev_stack'
  },
  {
    id: 'apphub-core-app',
    type: 'app',
    title: 'Register the AppHub repository',
    summary: 'Queues ingestion for this repository using the root Dockerfile.',
    description:
      'Demonstrates app registration by pointing the form at the current repository. Ingestion will build the root Dockerfile and surface detected integrations in the catalog.',
    difficulty: 'beginner',
    tags: ['monorepo', 'docker'],
    docs: [
      {
        label: 'App onboarding playbook',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/architecture.md#apps'
      }
    ],
    assets: [
      {
        label: 'Dockerfile',
        path: 'Dockerfile',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/Dockerfile'
      }
    ],
    form: {
      id: 'apphub-core',
      name: 'AppHub Core',
      description: 'Main AppHub repository (services, workers, UI).',
      repoUrl: 'https://github.com/benediktbwimmer/apphub.git',
      dockerfilePath: 'Dockerfile',
      tags: [
        { key: 'language', value: 'typescript' },
        { key: 'framework', value: 'fastify' }
      ],
      sourceType: 'remote'
    },
    analyticsTag: 'app__apphub_core'
  },
  {
    id: 'retail-sales-csv-loader-job',
    type: 'job',
    title: 'Retail sales CSV loader',
    summary: 'Stages the CSV ingest job that seeds `retail.sales.raw` partitions.',
    description:
      'Uploads the `retail-sales-csv-loader` bundle (0.1.0) so you can preview the ingest job against the sample dataset in `services/catalog/data/examples/retail-sales`. Perfect for exercising the ingest loop end-to-end.',
    difficulty: 'beginner',
    tags: ['ingest', 'retail sales'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Sample CSV dataset',
        path: 'services/catalog/data/examples/retail-sales/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/retail-sales'
      }
    ],
    form: {
      source: 'upload',
      reference: 'retail-sales-csv-loader@0.1.0',
      notes: 'Prebuilt bundle from job-bundles/retail-sales-csv-loader. Use services/catalog/data/examples/retail-sales as dataRoot when running.'
    },
    bundle: {
      filename: 'retail-sales-csv-loader-0.1.0.tgz',
      publicPath: '/examples/job-bundles/retail-sales-csv-loader-0.1.0.tgz',
      contentType: 'application/gzip'
    },
    analyticsTag: 'job__retail_sales_csv_loader'
  },
  {
    id: 'retail-sales-parquet-job',
    type: 'job',
    title: 'Retail sales parquet builder',
    summary: 'Builds curated Parquet assets from the example retail dataset.',
    description:
      'Uploads the `retail-sales-parquet-builder` bundle (0.1.0) so you can validate downstream materialization. Once the CSV loader fills partitions, run this job to emit `retail.sales.parquet` using the same data root.',
    difficulty: 'beginner',
    tags: ['fs capability', 'retail sales'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Bundle manifest',
        path: 'job-bundles/retail-sales-parquet-builder/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/retail-sales-parquet-builder/manifest.json'
      },
      {
        label: 'Sample CSV dataset',
        path: 'services/catalog/data/examples/retail-sales/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/retail-sales'
      }
    ],
    form: {
      source: 'upload',
      reference: 'retail-sales-parquet-builder@0.1.0',
      notes: 'Bundle sourced from job-bundles/retail-sales-parquet-builder. Leave notes to document which partitions you are building.'
    },
    bundle: {
      filename: 'retail-sales-parquet-builder-0.1.0.tgz',
      publicPath: '/examples/job-bundles/retail-sales-parquet-builder-0.1.0.tgz',
      contentType: 'application/gzip'
    },
    analyticsTag: 'job__retail_sales_parquet_builder'
  },
  {
    id: 'retail-sales-visualizer-job',
    type: 'job',
    title: 'Retail sales visualizer',
    summary: 'Publishes dashboard assets after Parquet assets refresh.',
    description:
      'Uploads the `retail-sales-visualizer` bundle (0.1.0) to complete the retail demo. The job reads the curated Parquet outputs and writes SVG/HTML artifacts so you can mirror the full walkthrough locally.',
    difficulty: 'beginner',
    tags: ['dashboard', 'retail sales'],
    docs: [
      {
        label: 'Retail sales workflow walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/retail-sales-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Visualization job manifest',
        path: 'job-bundles/retail-sales-visualizer/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/retail-sales-visualizer/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: 'retail-sales-visualizer@0.1.0',
      notes: 'Bundle packaged from job-bundles/retail-sales-visualizer. Point parameters at the Parquet output directory when running.'
    },
    bundle: {
      filename: 'retail-sales-visualizer-0.1.0.tgz',
      publicPath: '/examples/job-bundles/retail-sales-visualizer-0.1.0.tgz',
      contentType: 'application/gzip'
    },
    analyticsTag: 'job__retail_sales_visualizer'
  },
  {
    id: 'fleet-telemetry-metrics-job',
    type: 'job',
    title: 'Fleet telemetry metrics',
    summary: 'Aggregates raw instrument CSVs into rollup artifacts.',
    description:
      'Uploads the `fleet-telemetry-metrics` bundle (0.1.0). With the dataset under `services/catalog/data/examples/fleet-telemetry`, you can preview the rollup workflow and emit metrics per instrument/day.',
    difficulty: 'intermediate',
    tags: ['dynamic partitions', 'fleet telemetry'],
    docs: [
      {
        label: 'Fleet telemetry walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/fleet-telemetry-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Telemetry dataset',
        path: 'services/catalog/data/examples/fleet-telemetry/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/fleet-telemetry'
      },
      {
        label: 'Bundle manifest',
        path: 'job-bundles/fleet-telemetry-metrics/manifest.json',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/job-bundles/fleet-telemetry-metrics/manifest.json'
      }
    ],
    form: {
      source: 'upload',
      reference: 'fleet-telemetry-metrics@0.1.0',
      notes: 'Bundle built from job-bundles/fleet-telemetry-metrics. Use services/catalog/data/examples/fleet-telemetry as dataRoot when previewing.'
    },
    bundle: {
      filename: 'fleet-telemetry-metrics-0.1.0.tgz',
      publicPath: '/examples/job-bundles/fleet-telemetry-metrics-0.1.0.tgz',
      contentType: 'application/gzip'
    },
    analyticsTag: 'job__fleet_telemetry_metrics'
  },
  {
    id: 'greenhouse-alerts-runner-job',
    type: 'job',
    title: 'Greenhouse alerts runner',
    summary: 'Consumes telemetry rollups to raise greenhouse alerts.',
    description:
      'Uploads the `greenhouse-alerts-runner` bundle (0.1.0). Point the parameters at the rollup directory (`services/catalog/data/examples/fleet-telemetry-rollups`) to replay alert evaluation against the example metrics.',
    difficulty: 'intermediate',
    tags: ['alerts', 'fleet telemetry'],
    docs: [
      {
        label: 'Fleet telemetry walkthrough',
        href: 'https://github.com/benediktbwimmer/apphub/blob/main/docs/fleet-telemetry-workflows.md'
      }
    ],
    assets: [
      {
        label: 'Telemetry rollups',
        path: 'services/catalog/data/examples/fleet-telemetry-rollups/',
        href: 'https://github.com/benediktbwimmer/apphub/tree/main/services/catalog/data/examples/fleet-telemetry-rollups'
      }
    ],
    form: {
      source: 'upload',
      reference: 'greenhouse-alerts-runner@0.1.0',
      notes: 'Bundle packaged from job-bundles/greenhouse-alerts-runner. Provide telemetryDir pointing at services/catalog/data/examples/fleet-telemetry-rollups.'
    },
    bundle: {
      filename: 'greenhouse-alerts-runner-0.1.0.tgz',
      publicPath: '/examples/job-bundles/greenhouse-alerts-runner-0.1.0.tgz',
      contentType: 'application/gzip'
    },
    analyticsTag: 'job__greenhouse_alerts_runner'
  }
];
