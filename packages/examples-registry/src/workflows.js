"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXAMPLE_WORKFLOW_SLUGS = exports.EXAMPLE_WORKFLOWS = void 0;
exports.isExampleWorkflowSlug = isExampleWorkflowSlug;
exports.listExampleWorkflows = listExampleWorkflows;
exports.getExampleWorkflow = getExampleWorkflow;
const observatory_hourly_ingest_json_1 = __importDefault(require("../../../examples/environmental-observatory/workflows/observatory-hourly-ingest.json"));
const observatory_daily_publication_json_1 = __importDefault(require("../../../examples/environmental-observatory/workflows/observatory-daily-publication.json"));
const retail_sales_daily_ingest_json_1 = __importDefault(require("../../../examples/retail-sales/workflows/retail-sales-daily-ingest.json"));
const retail_sales_insights_json_1 = __importDefault(require("../../../examples/retail-sales/workflows/retail-sales-insights.json"));
const fleet_telemetry_daily_rollup_json_1 = __importDefault(require("../../../examples/fleet-telemetry/workflows/fleet-telemetry-daily-rollup.json"));
const fleet_telemetry_alerts_json_1 = __importDefault(require("../../../examples/fleet-telemetry/workflows/fleet-telemetry-alerts.json"));
const directory_insights_report_json_1 = __importDefault(require("../../../examples/directory-insights/workflows/directory-insights-report.json"));
const directory_insights_archive_json_1 = __importDefault(require("../../../examples/directory-insights/workflows/directory-insights-archive.json"));
function workflowDefinition(json) {
    return json;
}
function createWorkflow(params) {
    return {
        slug: params.slug,
        path: params.path,
        definition: workflowDefinition(params.json)
    };
}
exports.EXAMPLE_WORKFLOWS = [
    createWorkflow({
        slug: 'observatory-hourly-ingest',
        path: 'examples/environmental-observatory/workflows/observatory-hourly-ingest.json',
        json: observatory_hourly_ingest_json_1.default
    }),
    createWorkflow({
        slug: 'observatory-daily-publication',
        path: 'examples/environmental-observatory/workflows/observatory-daily-publication.json',
        json: observatory_daily_publication_json_1.default
    }),
    createWorkflow({
        slug: 'retail-sales-daily-ingest',
        path: 'examples/retail-sales/workflows/retail-sales-daily-ingest.json',
        json: retail_sales_daily_ingest_json_1.default
    }),
    createWorkflow({
        slug: 'retail-sales-insights',
        path: 'examples/retail-sales/workflows/retail-sales-insights.json',
        json: retail_sales_insights_json_1.default
    }),
    createWorkflow({
        slug: 'fleet-telemetry-daily-rollup',
        path: 'examples/fleet-telemetry/workflows/fleet-telemetry-daily-rollup.json',
        json: fleet_telemetry_daily_rollup_json_1.default
    }),
    createWorkflow({
        slug: 'fleet-telemetry-alerts',
        path: 'examples/fleet-telemetry/workflows/fleet-telemetry-alerts.json',
        json: fleet_telemetry_alerts_json_1.default
    }),
    createWorkflow({
        slug: 'directory-insights-report',
        path: 'examples/directory-insights/workflows/directory-insights-report.json',
        json: directory_insights_report_json_1.default
    }),
    createWorkflow({
        slug: 'directory-insights-archive',
        path: 'examples/directory-insights/workflows/directory-insights-archive.json',
        json: directory_insights_archive_json_1.default
    })
];
exports.EXAMPLE_WORKFLOW_SLUGS = exports.EXAMPLE_WORKFLOWS.map((workflow) => workflow.slug);
const WORKFLOW_SET = new Set(exports.EXAMPLE_WORKFLOW_SLUGS);
const WORKFLOW_MAP = exports.EXAMPLE_WORKFLOWS.reduce((acc, workflow) => {
    acc[workflow.slug] = workflow;
    return acc;
}, {});
function isExampleWorkflowSlug(value) {
    return WORKFLOW_SET.has(value);
}
function listExampleWorkflows() {
    return exports.EXAMPLE_WORKFLOWS;
}
function getExampleWorkflow(slug) {
    return WORKFLOW_MAP[slug];
}
//# sourceMappingURL=workflows.js.map