import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSearchQuery } from '../../src/search/queryBuilder';
import { DEFAULT_SUMMARY_PROJECTION } from '../../src/search/projections';

test('selects all columns when projection is omitted', () => {
  const query = buildSearchQuery({ namespace: 'analytics' });
  assert.match(query.text, /SELECT \*, COUNT\(\*\) OVER\(\) AS total_count/);
  assert.equal(query.values[0], 'analytics');
});

test('includes metadata column when projection references metadata paths', () => {
  const query = buildSearchQuery({
    namespace: 'analytics',
    projection: ['namespace', 'key', 'metadata.status', 'tags']
  });

  const [selectClause] = query.text.split('FROM');
  assert.match(selectClause, /metastore_records\.metadata/);
  assert.match(selectClause, /metastore_records\.tags/);
  assert.match(selectClause, /metastore_records\.namespace/);
  assert.match(selectClause, /metastore_records\.record_key/);
});

test('omits metadata column for summary projections', () => {
  const query = buildSearchQuery({
    namespace: 'analytics',
    projection: [...DEFAULT_SUMMARY_PROJECTION]
  });

  const [selectClause] = query.text.split('FROM');
  assert.doesNotMatch(selectClause, /metastore_records\.metadata/);
  assert.match(selectClause, /metastore_records\.record_key/);
  assert.match(selectClause, /metastore_records\.updated_at/);
});

test('adds full-text predicate when search term is provided', () => {
  const query = buildSearchQuery({ namespace: 'analytics', search: 'galaxy' });
  assert.match(
    query.text,
    /to_tsvector\('simple', metastore_records\.record_key \|\| ' ' \|\| COALESCE\(metastore_records\.metadata::text, ''\)\) @@ plainto_tsquery\('simple', \$\d+\)/
  );
  assert.equal(query.values[1], 'galaxy');
});
