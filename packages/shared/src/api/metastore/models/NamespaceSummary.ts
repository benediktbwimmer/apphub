/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { NamespaceOwnerCount } from './NamespaceOwnerCount';
export type NamespaceSummary = {
  name: string;
  totalRecords: number;
  deletedRecords: number;
  lastUpdatedAt: string | null;
  ownerCounts?: Array<NamespaceOwnerCount>;
};

