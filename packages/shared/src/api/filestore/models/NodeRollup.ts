/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type NodeRollup = {
  /**
   * Identifier of the node associated with this rollup.
   */
  nodeId: number;
  /**
   * Total bytes attributed to the subtree.
   */
  sizeBytes: number;
  /**
   * Number of files in the subtree.
   */
  fileCount: number;
  /**
   * Number of directories in the subtree.
   */
  directoryCount: number;
  /**
   * Total direct children tracked in the rollup.
   */
  childCount: number;
  /**
   * Freshness indicator for the rollup snapshot.
   */
  state: 'up_to_date' | 'pending' | 'stale' | 'invalid';
  /**
   * Timestamp of the most recent rollup calculation.
   */
  lastCalculatedAt: string | null;
};

