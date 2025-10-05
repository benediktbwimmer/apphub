/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MetastoreRecord } from './MetastoreRecord';
export type BulkOperationResult = ({
  status: 'ok';
  type: 'upsert' | 'delete';
  namespace: string;
  key: string;
  created?: boolean;
  record: MetastoreRecord;
} | {
  status: 'error';
  namespace: string;
  key: string;
  error: {
    statusCode: number;
    code: string;
    message: string;
  };
});

