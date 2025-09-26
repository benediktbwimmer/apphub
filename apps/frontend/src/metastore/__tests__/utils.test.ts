import { describe, expect, it } from 'vitest';
import {
  parseMetadataInput,
  parseTagsInput,
  prepareBulkPayload,
  extractCrossLinks,
  mapMetastoreError
} from '../utils';
import type { MetastoreRecordDetail } from '../types';

describe('metastore utils', () => {
  it('parses metadata JSON input', () => {
    const result = parseMetadataInput('{"foo": "bar"}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('throws on invalid metadata JSON', () => {
    expect(() => parseMetadataInput('{invalid')).toThrow();
  });

  it('parses tags input', () => {
    expect(parseTagsInput('alpha, beta , , gamma')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('prepares bulk payload from array', () => {
    const payload = prepareBulkPayload(
      JSON.stringify([
        { type: 'upsert', namespace: 'default', key: 'a', metadata: { foo: 'bar' } }
      ]),
      true
    );
    expect(payload.operations).toHaveLength(1);
    expect(payload.continueOnError).toBe(true);
  });

  it('extracts cross links from metadata', () => {
    const detail = {
      id: '1',
      namespace: 'default',
      recordKey: 'foo',
      metadata: { datasetSlug: 'observatory.timeseries', assetId: 'asset-1' },
      tags: [],
      version: 1,
      createdAt: '',
      updatedAt: '',
      deletedAt: null
    } as unknown as MetastoreRecordDetail;

    expect(extractCrossLinks(detail)).toEqual({ datasetSlug: 'observatory.timeseries', assetId: 'asset-1' });
  });

  it('maps optimistic locking errors', () => {
    const error = new Error('version conflict detected');
    expect(mapMetastoreError(error)).toMatch(/Refresh/);
  });
});
