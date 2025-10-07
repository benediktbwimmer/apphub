"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_net_1 = __importDefault(require("node:net"));
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const embedded_postgres_1 = __importDefault(require("embedded-postgres"));
const app_1 = require("../../src/app");
const client_1 = require("../../src/db/client");
async function findAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = node_net_1.default.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (typeof address === 'object' && address) {
                const { port } = address;
                server.close(() => resolve(port));
            }
            else {
                server.close(() => reject(new Error('Failed to allocate port')));
            }
        });
    });
}
(0, node_test_1.default)('metastore record lifecycle', async (t) => {
    process.env.APPHUB_AUTH_DISABLED = '1';
    process.env.NODE_ENV = 'test';
    const dataRoot = await (0, promises_1.mkdtemp)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'metastore-pg-'));
    const port = await findAvailablePort();
    const postgres = new embedded_postgres_1.default({
        databaseDir: dataRoot,
        port,
        user: 'postgres',
        password: 'postgres',
        persistent: false
    });
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase('apphub');
    process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
    let app = null;
    t.afterEach(async () => {
        // noop - individual subtests handle cleanup
    });
    t.after(async () => {
        if (app) {
            await app.close();
        }
        await (0, client_1.closePool)();
        await postgres.stop();
        await (0, promises_1.rm)(dataRoot, { recursive: true, force: true });
    });
    const build = await (0, app_1.buildApp)();
    app = build.app;
    await app.ready();
    // Create record
    const createResponse = await app.inject({
        method: 'POST',
        url: '/records',
        payload: {
            namespace: 'analytics',
            key: 'pipeline-1',
            metadata: {
                status: 'active',
                version: 1,
                thresholds: { latencyMs: 250 }
            },
            tags: ['beta', 'pipelines'],
            owner: 'data-team@apphub.dev',
            schemaHash: 'sha256:abc123'
        }
    });
    strict_1.default.equal(createResponse.statusCode, 201, createResponse.body);
    const createBody = createResponse.json();
    strict_1.default.equal(createBody.created, true);
    strict_1.default.equal(createBody.record.namespace, 'analytics');
    strict_1.default.equal(createBody.record.key, 'pipeline-1');
    strict_1.default.equal(createBody.record.metadata.status, 'active');
    // Fetch record
    const fetchResponse = await app.inject({
        method: 'GET',
        url: '/records/analytics/pipeline-1'
    });
    strict_1.default.equal(fetchResponse.statusCode, 200, fetchResponse.body);
    const fetchBody = fetchResponse.json();
    strict_1.default.equal(fetchBody.record.version, 1);
    strict_1.default.deepEqual(fetchBody.record.tags.sort(), ['beta', 'pipelines']);
    // Update record via PUT
    const updateResponse = await app.inject({
        method: 'PUT',
        url: '/records/analytics/pipeline-1',
        payload: {
            metadata: {
                status: 'paused',
                version: 2,
                notes: ['maintenance']
            },
            tags: ['pipelines', 'maintenance'],
            owner: 'data-team@apphub.dev'
        }
    });
    strict_1.default.equal(updateResponse.statusCode, 200, updateResponse.body);
    const updateBody = updateResponse.json();
    strict_1.default.equal(updateBody.record.version, 2);
    strict_1.default.equal(updateBody.record.metadata.status, 'paused');
    // Search records
    const searchResponse = await app.inject({
        method: 'POST',
        url: '/records/search',
        payload: {
            namespace: 'analytics',
            filter: {
                type: 'condition',
                condition: {
                    field: 'metadata.status',
                    operator: 'eq',
                    value: 'paused'
                }
            }
        }
    });
    strict_1.default.equal(searchResponse.statusCode, 200, searchResponse.body);
    const searchBody = searchResponse.json();
    strict_1.default.equal(searchBody.pagination.total, 1);
    strict_1.default.equal(searchBody.records[0]?.metadata.status, 'paused');
    // Bulk upsert + delete
    const bulkResponse = await app.inject({
        method: 'POST',
        url: '/records/bulk',
        payload: {
            operations: [
                {
                    namespace: 'analytics',
                    key: 'pipeline-1',
                    metadata: {
                        status: 'retired'
                    },
                    tags: ['pipelines']
                },
                {
                    type: 'delete',
                    namespace: 'analytics',
                    key: 'pipeline-1'
                }
            ]
        }
    });
    strict_1.default.equal(bulkResponse.statusCode, 200, bulkResponse.body);
    const bulkBody = bulkResponse.json();
    strict_1.default.equal(bulkBody.operations.length, 2);
    strict_1.default.equal(bulkBody.operations[0]?.type, 'upsert');
    strict_1.default.equal(bulkBody.operations[1]?.type, 'delete');
    // Fetch record including deleted
    const fetchDeleted = await app.inject({
        method: 'GET',
        url: '/records/analytics/pipeline-1?includeDeleted=true'
    });
    strict_1.default.equal(fetchDeleted.statusCode, 200, fetchDeleted.body);
    const deletedBody = fetchDeleted.json();
    strict_1.default.ok(deletedBody.record.deletedAt);
});
//# sourceMappingURL=records.test.js.map