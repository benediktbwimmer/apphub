"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExamplesCatalogIndex = buildExamplesCatalogIndex;
const jobs_1 = require("./jobs");
const workflows_1 = require("./workflows");
function buildExamplesCatalogIndex() {
    return {
        jobs: jobs_1.EXAMPLE_JOB_BUNDLES.reduce((acc, bundle) => {
            acc[bundle.slug] = bundle.jobDefinitionPath;
            return acc;
        }, {}),
        workflows: workflows_1.EXAMPLE_WORKFLOWS.reduce((acc, workflow) => {
            acc[workflow.slug] = workflow.path;
            return acc;
        }, {})
    };
}
//# sourceMappingURL=catalogIndex.js.map