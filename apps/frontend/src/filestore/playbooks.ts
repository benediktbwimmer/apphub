import type { FilestoreNode, FilestoreNodeState, FilestoreReconciliationReason } from './types';

type BaseAction = {
  id: string;
  label: string;
  description: string;
};

export type PlaybookReconcileAction = BaseAction & {
  type: 'reconcile';
  reason: FilestoreReconciliationReason;
  detectChildren?: boolean;
  requestHash?: boolean;
};

export type PlaybookWorkflowAction = BaseAction & {
  type: 'workflow';
  workflowSlug: string;
  triggeredBy?: string;
  buildParameters?: (context: PlaybookContext) => Record<string, unknown>;
  fallbackText?: string;
};

export type PlaybookLinkAction = BaseAction & {
  type: 'link';
  href: (context: PlaybookContext) => string;
  external?: boolean;
};

export type PlaybookAction = PlaybookReconcileAction | PlaybookWorkflowAction | PlaybookLinkAction;

export type PlaybookContext = {
  node: Pick<FilestoreNode, 'backendMountId' | 'path' | 'state' | 'metadata'>;
};

export type FilestorePlaybook = {
  id: string;
  title: string;
  summary: string;
  states: FilestoreNodeState[];
  actions: PlaybookAction[];
  note?: string;
};

function buildRunsHref(context: PlaybookContext): string {
  const encodedPath = encodeURIComponent(context.node.path);
  return `/runs?tab=workflows&search=${encodedPath}`;
}

export const FILESTORE_DRIFT_PLAYBOOKS: ReadonlyArray<FilestorePlaybook> = [
  {
    id: 'inconsistent-standard-remediation',
    title: 'Heal inconsistent node',
    summary: 'Prioritise reconciliation and capture a workflow audit when drift is detected.',
    states: ['inconsistent'],
    actions: [
      {
        type: 'reconcile',
        id: 'reconcile-targeted-drift',
        label: 'Queue drift reconciliation',
        description: 'Reconciles the node using the drift reason and captures a fresh content hash.',
        reason: 'drift',
        requestHash: true
      },
      {
        type: 'workflow',
        id: 'workflow-drift-audit',
        label: 'Run drift audit workflow',
        description: 'Launches the shared audit workflow to review recent commands and watcher signals.',
        workflowSlug: 'filestore-drift-audit',
        triggeredBy: 'filestore-playbook',
        buildParameters: (context) => ({
          backendMountId: context.node.backendMountId,
          path: context.node.path
        }),
        fallbackText:
          'Register the filestore-drift-audit workflow to automatically gather command context when drift is detected.'
      },
      {
        type: 'link',
        id: 'link-inspect-commands',
        label: 'Inspect recent commands',
        description: 'Open workflow runs filtered to this path for manual review if automation is unavailable.',
        href: buildRunsHref
      }
    ],
    note: 'Ensure chokidar/S3 watchers stay online so drift jobs continue to populate this queue.'
  },
  {
    id: 'missing-node-investigation',
    title: 'Investigate missing node',
    summary: 'Confirm whether the node has been removed intentionally and rebuild metadata as needed.',
    states: ['missing'],
    actions: [
      {
        type: 'reconcile',
        id: 'reconcile-missing-with-children',
        label: 'Reconcile subtree',
        description: 'Enqueue reconciliation with child detection to repopulate descendants or confirm removal.',
        reason: 'audit',
        detectChildren: true,
        requestHash: true
      },
      {
        type: 'workflow',
        id: 'workflow-restore-missing',
        label: 'Run restore workflow',
        description: 'Fire the restoration workflow to rebuild or archive the missing node contents.',
        workflowSlug: 'filestore-restore-missing-node',
        triggeredBy: 'filestore-playbook',
        buildParameters: (context) => ({
          backendMountId: context.node.backendMountId,
          path: context.node.path
        }),
        fallbackText:
          'Provision the filestore-restore-missing-node workflow (or equivalent) so operators can restore data with one click.'
      },
      {
        type: 'link',
        id: 'link-review-audits',
        label: 'Review audit history',
        description: 'Check recent workflow runs that touched this path before restoring from backups.',
        href: buildRunsHref
      }
    ],
    note: 'Coordinate with data owners before restoring deleted content to avoid duplicating intentional removals.'
  },
  {
    id: 'unknown-state-triage',
    title: 'Triage unknown state',
    summary: 'Gather context and run a manual sweep when watcher output is unavailable.',
    states: ['inconsistent'],
    actions: [
      {
        type: 'reconcile',
        id: 'reconcile-manual-sweep',
        label: 'Request manual reconciliation',
        description: 'Queue a manual reconciliation pass to refresh metadata for this node.',
        reason: 'manual',
        detectChildren: true
      },
      {
        type: 'workflow',
        id: 'workflow-manual-sweep-report',
        label: 'Run sweep report',
        description: 'Trigger the sweep report workflow to capture filesystem state snapshots.',
        workflowSlug: 'filestore-manual-sweep-report',
        triggeredBy: 'filestore-playbook',
        buildParameters: (context) => ({
          backendMountId: context.node.backendMountId,
          path: context.node.path
        }),
        fallbackText:
          'Register the filestore-manual-sweep-report workflow or wire an equivalent automation to capture snapshots.'
      }
    ],
    note: 'Unknown nodes often indicate unregistered mounts or paused watchers – verify infrastructure before rerunning workloads.'
  }
] as const;

export function getPlaybookForState(state: FilestoreNodeState): FilestorePlaybook | null {
  for (const playbook of FILESTORE_DRIFT_PLAYBOOKS) {
    if (playbook.states.includes(state)) {
      return playbook;
    }
  }
  return null;
}

export function playbooksRequireWorkflows(playbooks: ReadonlyArray<FilestorePlaybook>): boolean {
  return playbooks.some((playbook) => playbook.actions.some((action) => action.type === 'workflow'));
}
