"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isScenarioType = isScenarioType;
exports.groupScenariosByType = groupScenariosByType;
function isScenarioType(scenario, type) {
    return scenario.type === type;
}
function groupScenariosByType(scenarios) {
    return scenarios.reduce((acc, scenario) => {
        switch (scenario.type) {
            case 'service-manifest':
                acc['service-manifest'].push(scenario);
                break;
            case 'app':
                acc.app.push(scenario);
                break;
            case 'job':
                acc.job.push(scenario);
                break;
            case 'workflow':
                acc.workflow.push(scenario);
                break;
            case 'scenario':
                acc.scenario.push(scenario);
                break;
            default:
                break;
        }
        return acc;
    }, { 'service-manifest': [], app: [], job: [], workflow: [], scenario: [] });
}
//# sourceMappingURL=types.js.map