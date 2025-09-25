import type { ExampleWorkflow, ExampleWorkflowSlug } from './types';
export declare const EXAMPLE_WORKFLOWS: ReadonlyArray<ExampleWorkflow>;
export declare const EXAMPLE_WORKFLOW_SLUGS: ReadonlyArray<ExampleWorkflowSlug>;
export declare function isExampleWorkflowSlug(value: string): value is ExampleWorkflowSlug;
export declare function listExampleWorkflows(): ReadonlyArray<ExampleWorkflow>;
export declare function getExampleWorkflow(slug: ExampleWorkflowSlug): ExampleWorkflow | undefined;
//# sourceMappingURL=workflows.d.ts.map