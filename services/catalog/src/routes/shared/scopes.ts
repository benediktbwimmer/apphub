import type { OperatorScope } from '../../auth/tokens';

export const JOB_WRITE_SCOPES: OperatorScope[] = ['jobs:write'];
export const JOB_RUN_SCOPES: OperatorScope[] = ['jobs:run'];
export const WORKFLOW_WRITE_SCOPES: OperatorScope[] = ['workflows:write'];
export const WORKFLOW_RUN_SCOPES: OperatorScope[] = ['workflows:run'];
export const JOB_BUNDLE_WRITE_SCOPES: OperatorScope[] = ['job-bundles:write'];
export const JOB_BUNDLE_READ_SCOPES: OperatorScope[] = ['job-bundles:read'];
