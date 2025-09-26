import type { RollupRecord, RollupState } from '../db/rollups';

export type RollupSummary = {
  nodeId: number;
  sizeBytes: number;
  fileCount: number;
  directoryCount: number;
  childCount: number;
  state: RollupState;
  lastCalculatedAt: Date | null;
};

export type RollupIncrement = {
  nodeId: number;
  sizeBytesDelta: number;
  fileCountDelta: number;
  directoryCountDelta: number;
  childCountDelta: number;
  markPending?: boolean;
};

export type RollupInvalidate = {
  nodeId: number;
  state: RollupState;
};

export type RollupScheduleCandidate = {
  nodeId: number;
  backendMountId: number;
  reason: 'mutation' | 'manual' | 'pending-refresh';
  depth: number;
  childCountDelta: number;
};

export type RollupPlan = {
  ensure: number[];
  increments: RollupIncrement[];
  invalidate: RollupInvalidate[];
  touchedNodeIds: number[];
  scheduleCandidates: RollupScheduleCandidate[];
};

export type AppliedRollupPlan = {
  updated: Map<number, RollupRecord>;
};

export function createEmptyRollupPlan(): RollupPlan {
  return {
    ensure: [],
    increments: [],
    invalidate: [],
    touchedNodeIds: [],
    scheduleCandidates: []
  };
}

export function rollupRecordToSummary(record: RollupRecord): RollupSummary {
  return {
    nodeId: record.nodeId,
    sizeBytes: record.sizeBytes,
    fileCount: record.fileCount,
    directoryCount: record.directoryCount,
    childCount: record.childCount,
    state: record.state,
    lastCalculatedAt: record.lastCalculatedAt
  };
}
