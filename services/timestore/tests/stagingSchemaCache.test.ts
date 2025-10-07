import './testEnv';

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  clearStagingSchemaCache,
  getStagingSchemaCacheEntry,
  markStagingSchemaCacheStale,
  resetStagingSchemaCache,
  setStagingSchemaCache
} from '../src/cache/stagingSchemaCache';

afterEach(() => {
  resetStagingSchemaCache();
});

test('setStagingSchemaCache stores a defensive copy and returns fresh clones', () => {
  const fields = [
    { name: 'timestamp', type: 'timestamp', nullable: false, description: 'primary time' },
    { name: 'value', type: 'double', nullable: true, description: null }
  ];

  setStagingSchemaCache('demo-dataset', fields);

  // Mutate the original array to ensure cache keeps its own copy.
  fields[0].type = 'string';
  fields.push({ name: 'extra', type: 'string', nullable: true, description: null });

  const entry = getStagingSchemaCacheEntry('demo-dataset');
  assert.ok(entry);
  assert.equal(entry.stale, false);
  assert.equal(entry.schemaVersion, null);
  assert.equal(entry.fields.length, 2);
  assert.equal(entry.fields[0].type, 'timestamp');

  // Mutating the returned reference should not affect subsequent reads.
  entry.fields[0].type = 'integer';
  const fresh = getStagingSchemaCacheEntry('demo-dataset');
  assert.ok(fresh);
  assert.equal(fresh.fields[0].type, 'timestamp');
});

test('markStagingSchemaCacheStale toggles stale flag without dropping fields', () => {
  setStagingSchemaCache(
    'dataset-stale',
    [{ name: 'value', type: 'double', nullable: true, description: null }],
    { schemaVersion: 3 }
  );

  markStagingSchemaCacheStale('dataset-stale');

  const entry = getStagingSchemaCacheEntry('dataset-stale');
  assert.ok(entry);
  assert.equal(entry.stale, true);
  assert.equal(entry.schemaVersion, 3);
  assert.equal(entry.fields.length, 1);
});

test('clearStagingSchemaCache removes cached entries', () => {
  setStagingSchemaCache('dataset-clear', [{ name: 'value', type: 'double', nullable: true, description: null }]);
  assert.ok(getStagingSchemaCacheEntry('dataset-clear'));

  clearStagingSchemaCache('dataset-clear');
  assert.equal(getStagingSchemaCacheEntry('dataset-clear'), null);
});

test('resetStagingSchemaCache clears all datasets', () => {
  setStagingSchemaCache('dataset-one', [{ name: 'value', type: 'double', nullable: true, description: null }]);
  setStagingSchemaCache('dataset-two', [{ name: 'value', type: 'double', nullable: true, description: null }]);

  resetStagingSchemaCache();

  assert.equal(getStagingSchemaCacheEntry('dataset-one'), null);
  assert.equal(getStagingSchemaCacheEntry('dataset-two'), null);
});
