"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXAMPLE_JOB_SLUGS = exports.EXAMPLE_JOB_BUNDLES = void 0;
exports.isExampleJobSlug = isExampleJobSlug;
exports.listExampleJobBundles = listExampleJobBundles;
exports.getExampleJobBundle = getExampleJobBundle;
const manifest_json_1 = __importDefault(require("../../../examples/file-drop/jobs/file-relocator/manifest.json"));
const job_definition_json_1 = __importDefault(require("../../../examples/file-drop/jobs/file-relocator/job-definition.json"));
const manifest_json_2 = __importDefault(require("../../../examples/retail-sales/jobs/retail-sales-csv-loader/manifest.json"));
const job_definition_json_2 = __importDefault(require("../../../examples/retail-sales/jobs/retail-sales-csv-loader/job-definition.json"));
const manifest_json_3 = __importDefault(require("../../../examples/retail-sales/jobs/retail-sales-parquet-builder/manifest.json"));
const job_definition_json_3 = __importDefault(require("../../../examples/retail-sales/jobs/retail-sales-parquet-builder/job-definition.json"));
const manifest_json_4 = __importDefault(require("../../../examples/retail-sales/jobs/retail-sales-visualizer/manifest.json"));
const job_definition_json_4 = __importDefault(require("../../../examples/retail-sales/jobs/retail-sales-visualizer/job-definition.json"));
const manifest_json_5 = __importDefault(require("../../../examples/fleet-telemetry/jobs/fleet-telemetry-metrics/manifest.json"));
const job_definition_json_5 = __importDefault(require("../../../examples/fleet-telemetry/jobs/fleet-telemetry-metrics/job-definition.json"));
const manifest_json_6 = __importDefault(require("../../../examples/fleet-telemetry/jobs/greenhouse-alerts-runner/manifest.json"));
const job_definition_json_6 = __importDefault(require("../../../examples/fleet-telemetry/jobs/greenhouse-alerts-runner/job-definition.json"));
const manifest_json_7 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-inbox-normalizer/manifest.json"));
const job_definition_json_7 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-inbox-normalizer/job-definition.json"));
const manifest_json_8 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-duckdb-loader/manifest.json"));
const job_definition_json_8 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-duckdb-loader/job-definition.json"));
const manifest_json_9 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-visualization-runner/manifest.json"));
const job_definition_json_9 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-visualization-runner/job-definition.json"));
const manifest_json_10 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-report-publisher/manifest.json"));
const job_definition_json_10 = __importDefault(require("../../../examples/environmental-observatory/jobs/observatory-report-publisher/job-definition.json"));
const manifest_json_11 = __importDefault(require("../../../examples/directory-insights/jobs/scan-directory/manifest.json"));
const job_definition_json_11 = __importDefault(require("../../../examples/directory-insights/jobs/scan-directory/job-definition.json"));
const manifest_json_12 = __importDefault(require("../../../examples/directory-insights/jobs/generate-visualizations/manifest.json"));
const job_definition_json_12 = __importDefault(require("../../../examples/directory-insights/jobs/generate-visualizations/job-definition.json"));
const manifest_json_13 = __importDefault(require("../../../examples/directory-insights/jobs/archive-report/manifest.json"));
const job_definition_json_13 = __importDefault(require("../../../examples/directory-insights/jobs/archive-report/job-definition.json"));
function manifest(json) {
    return json;
}
function jobDefinition(json) {
    return json;
}
function createJobBundle(params) {
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
exports.EXAMPLE_JOB_BUNDLES = [
    createJobBundle({
        slug: 'file-relocator',
        directory: 'examples/file-drop/jobs/file-relocator',
        manifestJson: manifest_json_1.default,
        definitionJson: job_definition_json_1.default
    }),
    createJobBundle({
        slug: 'retail-sales-csv-loader',
        directory: 'examples/retail-sales/jobs/retail-sales-csv-loader',
        manifestJson: manifest_json_2.default,
        definitionJson: job_definition_json_2.default
    }),
    createJobBundle({
        slug: 'retail-sales-parquet-builder',
        directory: 'examples/retail-sales/jobs/retail-sales-parquet-builder',
        manifestJson: manifest_json_3.default,
        definitionJson: job_definition_json_3.default
    }),
    createJobBundle({
        slug: 'retail-sales-visualizer',
        directory: 'examples/retail-sales/jobs/retail-sales-visualizer',
        manifestJson: manifest_json_4.default,
        definitionJson: job_definition_json_4.default
    }),
    createJobBundle({
        slug: 'fleet-telemetry-metrics',
        directory: 'examples/fleet-telemetry/jobs/fleet-telemetry-metrics',
        manifestJson: manifest_json_5.default,
        definitionJson: job_definition_json_5.default
    }),
    createJobBundle({
        slug: 'greenhouse-alerts-runner',
        directory: 'examples/fleet-telemetry/jobs/greenhouse-alerts-runner',
        manifestJson: manifest_json_6.default,
        definitionJson: job_definition_json_6.default
    }),
    createJobBundle({
        slug: 'observatory-inbox-normalizer',
        directory: 'examples/environmental-observatory/jobs/observatory-inbox-normalizer',
        manifestJson: manifest_json_7.default,
        definitionJson: job_definition_json_7.default
    }),
    createJobBundle({
        slug: 'observatory-duckdb-loader',
        directory: 'examples/environmental-observatory/jobs/observatory-duckdb-loader',
        manifestJson: manifest_json_8.default,
        definitionJson: job_definition_json_8.default
    }),
    createJobBundle({
        slug: 'observatory-visualization-runner',
        directory: 'examples/environmental-observatory/jobs/observatory-visualization-runner',
        manifestJson: manifest_json_9.default,
        definitionJson: job_definition_json_9.default
    }),
    createJobBundle({
        slug: 'observatory-report-publisher',
        directory: 'examples/environmental-observatory/jobs/observatory-report-publisher',
        manifestJson: manifest_json_10.default,
        definitionJson: job_definition_json_10.default
    }),
    createJobBundle({
        slug: 'scan-directory',
        directory: 'examples/directory-insights/jobs/scan-directory',
        manifestJson: manifest_json_11.default,
        definitionJson: job_definition_json_11.default
    }),
    createJobBundle({
        slug: 'generate-visualizations',
        directory: 'examples/directory-insights/jobs/generate-visualizations',
        manifestJson: manifest_json_12.default,
        definitionJson: job_definition_json_12.default
    }),
    createJobBundle({
        slug: 'archive-report',
        directory: 'examples/directory-insights/jobs/archive-report',
        manifestJson: manifest_json_13.default,
        definitionJson: job_definition_json_13.default
    })
];
exports.EXAMPLE_JOB_SLUGS = exports.EXAMPLE_JOB_BUNDLES.map((bundle) => bundle.slug);
const JOB_SLUG_SET = new Set(exports.EXAMPLE_JOB_BUNDLES.map((bundle) => bundle.slug));
const JOB_BUNDLE_MAP = exports.EXAMPLE_JOB_BUNDLES.reduce((acc, bundle) => {
    acc[bundle.slug] = bundle;
    return acc;
}, {});
function isExampleJobSlug(value) {
    return JOB_SLUG_SET.has(value);
}
function listExampleJobBundles() {
    return exports.EXAMPLE_JOB_BUNDLES;
}
function getExampleJobBundle(slug) {
    return JOB_BUNDLE_MAP[slug];
}
//# sourceMappingURL=jobs.js.map