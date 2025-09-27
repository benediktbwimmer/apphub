import type {
  ExampleWorkflow,
  ExampleWorkflowSlug,
  WorkflowDefinitionTemplate
} from './types';

import observatoryMinuteDataGeneratorWorkflowJson from '../../../examples/environmental-observatory-event-driven/workflows/observatory-minute-data-generator.json';
import observatoryMinuteIngestWorkflowJson from '../../../examples/environmental-observatory-event-driven/workflows/observatory-minute-ingest.json';
import observatoryDailyPublicationWorkflowJson from '../../../examples/environmental-observatory-event-driven/workflows/observatory-daily-publication.json';
import retailSalesDailyIngestWorkflowJson from '../../../examples/retail-sales/workflows/retail-sales-daily-ingest.json';
import retailSalesInsightsWorkflowJson from '../../../examples/retail-sales/workflows/retail-sales-insights.json';
import fleetTelemetryDailyRollupWorkflowJson from '../../../examples/fleet-telemetry/workflows/fleet-telemetry-daily-rollup.json';
import fleetTelemetryAlertsWorkflowJson from '../../../examples/fleet-telemetry/workflows/fleet-telemetry-alerts.json';
import directoryInsightsReportWorkflowJson from '../../../examples/directory-insights/workflows/directory-insights-report.json';
import directoryInsightsArchiveWorkflowJson from '../../../examples/directory-insights/workflows/directory-insights-archive.json';

function workflowDefinition(json: unknown): WorkflowDefinitionTemplate {
  return json as WorkflowDefinitionTemplate;
}

function createWorkflow(params: { slug: ExampleWorkflowSlug; path: string; json: unknown }): ExampleWorkflow {
  return {
    slug: params.slug,
    path: params.path,
    definition: workflowDefinition(params.json)
  };
}

export const EXAMPLE_WORKFLOWS: ReadonlyArray<ExampleWorkflow> = [
  createWorkflow({
    slug: 'observatory-minute-data-generator',
    path: 'examples/environmental-observatory-event-driven/workflows/observatory-minute-data-generator.json',
    json: observatoryMinuteDataGeneratorWorkflowJson
  }),
  createWorkflow({
    slug: 'observatory-minute-ingest',
    path: 'examples/environmental-observatory-event-driven/workflows/observatory-minute-ingest.json',
    json: observatoryMinuteIngestWorkflowJson
  }),
  createWorkflow({
    slug: 'observatory-daily-publication',
    path: 'examples/environmental-observatory-event-driven/workflows/observatory-daily-publication.json',
    json: observatoryDailyPublicationWorkflowJson
  }),
  createWorkflow({
    slug: 'retail-sales-daily-ingest',
    path: 'examples/retail-sales/workflows/retail-sales-daily-ingest.json',
    json: retailSalesDailyIngestWorkflowJson
  }),
  createWorkflow({
    slug: 'retail-sales-insights',
    path: 'examples/retail-sales/workflows/retail-sales-insights.json',
    json: retailSalesInsightsWorkflowJson
  }),
  createWorkflow({
    slug: 'fleet-telemetry-daily-rollup',
    path: 'examples/fleet-telemetry/workflows/fleet-telemetry-daily-rollup.json',
    json: fleetTelemetryDailyRollupWorkflowJson
  }),
  createWorkflow({
    slug: 'fleet-telemetry-alerts',
    path: 'examples/fleet-telemetry/workflows/fleet-telemetry-alerts.json',
    json: fleetTelemetryAlertsWorkflowJson
  }),
  createWorkflow({
    slug: 'directory-insights-report',
    path: 'examples/directory-insights/workflows/directory-insights-report.json',
    json: directoryInsightsReportWorkflowJson
  }),
  createWorkflow({
    slug: 'directory-insights-archive',
    path: 'examples/directory-insights/workflows/directory-insights-archive.json',
    json: directoryInsightsArchiveWorkflowJson
  })
] as const;

export const EXAMPLE_WORKFLOW_SLUGS = EXAMPLE_WORKFLOWS.map((workflow) => workflow.slug) as ReadonlyArray<ExampleWorkflowSlug>;

const WORKFLOW_SET = new Set(EXAMPLE_WORKFLOW_SLUGS);

const WORKFLOW_MAP: Record<ExampleWorkflowSlug, ExampleWorkflow> = EXAMPLE_WORKFLOWS.reduce(
  (acc, workflow) => {
    acc[workflow.slug] = workflow;
    return acc;
  },
  {} as Record<ExampleWorkflowSlug, ExampleWorkflow>
);

export function isExampleWorkflowSlug(value: string): value is ExampleWorkflowSlug {
  return WORKFLOW_SET.has(value as ExampleWorkflowSlug);
}

export function listExampleWorkflows(): ReadonlyArray<ExampleWorkflow> {
  return EXAMPLE_WORKFLOWS;
}

export function getExampleWorkflow(slug: ExampleWorkflowSlug): ExampleWorkflow | undefined {
  return WORKFLOW_MAP[slug];
}
