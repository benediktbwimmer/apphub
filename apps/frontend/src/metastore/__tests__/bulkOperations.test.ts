import { describe, expect, it } from 'vitest';
import {
  buildBulkPayloadFromRows,
  parseBulkCsvInput,
  parseBulkJsonInput,
  parseBulkJsonlInput,
  stringifyBulkPayload
} from '../bulkOperations';

const UPSERT_OPERATION = {
  type: 'upsert',
  namespace: 'default',
  key: 'alpha',
  metadata: { foo: 'bar' }
};

const DELETE_OPERATION = {
  type: 'delete',
  namespace: 'default',
  key: 'beta'
};

describe('bulk operations parsing', () => {
  it('parses JSON array input with suggested continueOnError', () => {
    const payload = {
      operations: [UPSERT_OPERATION, DELETE_OPERATION],
      continueOnError: true
    };
    const result = parseBulkJsonInput(JSON.stringify(payload));
    expect(result.validRows).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.suggestedContinueOnError).toBe(true);
  });

  it('parses JSONL input and surfaces per-line errors', () => {
    const jsonl = [
      JSON.stringify(UPSERT_OPERATION),
      JSON.stringify({ ...DELETE_OPERATION, type: 'noop' }),
      '{invalid json}'
    ].join('\n');

    const result = parseBulkJsonlInput(jsonl);
    expect(result.rows).toHaveLength(3);
    expect(result.validRows).toHaveLength(1);
    expect(result.invalidRows).toHaveLength(2);
    expect(result.invalidRows[0].error).toMatch(/Line 2/);
    expect(result.invalidRows[1].error).toMatch(/Line 3/);
  });

  it('parses CSV input with metadata and tags', () => {
    const csv = [
      'type,namespace,key,metadata,tags,expectedVersion',
      'upsert,default,alpha,"{""foo"":""bar""}",tag-a|tag-b,',
      'delete,default,beta,,,42'
    ].join('\n');

    const result = parseBulkCsvInput(csv);
    expect(result.validRows).toHaveLength(2);
    expect(result.invalidRows).toHaveLength(0);
    const payload = buildBulkPayloadFromRows(result.rows, false);
    expect(payload?.operations).toHaveLength(2);
  });

  it('fails CSV parsing when required headers missing', () => {
    const csv = ['namespace,key', 'default,alpha'].join('\n');
    expect(() => parseBulkCsvInput(csv)).toThrow(/CSV header must include/);
  });

  it('stringifies payload with continueOnError flag', () => {
    const payload = parseBulkJsonInput(JSON.stringify([UPSERT_OPERATION]));
    const json = stringifyBulkPayload(payload.rows, true);
    expect(json).toContain('"continueOnError": true');
  });
});
