import type { FilestoreReconciliationReason } from '@apphub/shared/filestoreEvents';
import type { NodeRecord } from '../db/nodes';
import type { AppliedRollupPlan, RollupPlan } from '../rollup/types';

export type ReconciliationReason = FilestoreReconciliationReason;

export interface ReconciliationJobPayload {
  backendMountId: number;
  nodeId: number | null;
  path: string;
  reason: ReconciliationReason;
  detectChildren?: boolean;
  requestedHash?: boolean;
  attempt?: number;
}

export type ReconciliationJobStatus = 'reconciled' | 'missing' | 'skipped';

export interface ReconciliationJobSummary {
  status: ReconciliationJobStatus;
  reason: ReconciliationReason;
  node?: NodeRecord | null;
  previousNode?: NodeRecord | null;
  plan?: RollupPlan | null;
  appliedPlan?: AppliedRollupPlan | null;
  emittedEvent?:
    | {
        type: 'filestore.node.reconciled';
        node: NodeRecord;
      }
    | {
        type: 'filestore.node.missing';
        node: NodeRecord;
        previousState: NodeRecord['state'] | null;
      }
    | null;
}
