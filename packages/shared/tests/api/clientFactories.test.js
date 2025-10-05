const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { createMetastoreClient } = require('../../dist/api/clientFactories.js');

const originalFetch = global.fetch;

describe('createMetastoreClient', () => {
  const requests = [];

  beforeEach(() => {
    requests.length = 0;
    global.fetch = async (url, init = {}) => {
      requests.push({ url, init });
      const body = {
        record: {
          namespace: 'default',
          key: 'example',
          metadata: {},
          tags: [],
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null
        }
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('attaches bearer token and respects base URL', async () => {
    const client = createMetastoreClient({
      baseUrl: 'https://metastore.example.dev',
      token: 'sample-token',
      withCredentials: true
    });

    await client.records.getRecord({ namespace: 'default', key: 'example' });

    assert.equal(requests.length, 1);
    const [{ url, init }] = requests;
    assert.equal(url, 'https://metastore.example.dev/records/default/example');
    assert.ok(init);
    assert.equal(init.credentials, 'include');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer sample-token');
  });
});
