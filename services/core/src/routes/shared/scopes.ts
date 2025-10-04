import type { OperatorScope } from '../../auth/tokens';

export const JOB_READ_SCOPES: OperatorScope[] = ['jobs:read'];
export const JOB_WRITE_SCOPES: OperatorScope[] = ['jobs:write'];
export const JOB_RUN_SCOPES: OperatorScope[] = ['jobs:run'];
export const WORKFLOW_READ_SCOPES: OperatorScope[] = ['workflows:read'];
export const WORKFLOW_WRITE_SCOPES: OperatorScope[] = ['workflows:write'];
export const WORKFLOW_RUN_SCOPES: OperatorScope[] = ['workflows:run'];
export const JOB_BUNDLE_WRITE_SCOPES: OperatorScope[] = ['job-bundles:write'];
export const JOB_BUNDLE_READ_SCOPES: OperatorScope[] = ['job-bundles:read'];
export const RUNTIME_SCALING_WRITE_SCOPES: OperatorScope[] = ['runtime:write'];
export const OBSERVATORY_READ_SCOPES: OperatorScope[] = ['filestore:read'];
export const OBSERVATORY_WRITE_SCOPES: OperatorScope[] = ['filestore:write'];
export const OBSERVATORY_REPROCESS_SCOPES: OperatorScope[] = ['filestore:write', 'workflows:run'];
export const ADMIN_DANGER_SCOPES: OperatorScope[] = ['admin:danger-zone'];
