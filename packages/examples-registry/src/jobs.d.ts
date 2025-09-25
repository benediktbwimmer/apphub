import type { ExampleJobBundle, ExampleJobSlug } from './types';
export declare const EXAMPLE_JOB_BUNDLES: ReadonlyArray<ExampleJobBundle>;
export declare const EXAMPLE_JOB_SLUGS: ReadonlyArray<ExampleJobSlug>;
export declare function isExampleJobSlug(value: string): value is ExampleJobSlug;
export declare function listExampleJobBundles(): ReadonlyArray<ExampleJobBundle>;
export declare function getExampleJobBundle(slug: ExampleJobSlug): ExampleJobBundle | undefined;
//# sourceMappingURL=jobs.d.ts.map