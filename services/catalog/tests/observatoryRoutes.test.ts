import './setupTestEnv';
import assert from 'node:assert/strict';
import path from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import type { CalibrationReprocessPlan } from '../src/observatory/calibrationTypes';

async function run(): Promise<void> {
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
  process.env.CATALOG_METASTORE_BASE_URL = 'http://metastore.test';
  process.env.CATALOG_METASTORE_TOKEN = 'metastore-test-token';
  process.env.CATALOG_FILESTORE_BASE_URL = 'http://filestore.test';
  process.env.CATALOG_FILESTORE_TOKEN = 'filestore-test-token';
  process.env.OBSERVATORY_FILESTORE_BACKEND_ID = '1';
  process.env.OBSERVATORY_CALIBRATIONS_PREFIX = 'datasets/observatory/calibrations';
  process.env.OBSERVATORY_CALIBRATION_PLANS_PREFIX = 'datasets/observatory/calibrations/plans';
  process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
    {
      token: 'ops-token',
      subject: 'observatory-ops',
      scopes: ['filestore:read', 'filestore:write', 'workflows:run']
    }
  ]);

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  const metastoreMock = mockAgent.get('http://metastore.test');
  const filestoreMock = mockAgent.get('http://filestore.test');

  const calibrationRecord = {
    key: 'instrument_alpha:2025-01-01T00:00:00.000Z',
    version: 3,
    metadata: {
      instrumentId: 'instrument_alpha',
      effectiveAt: '2025-01-01T00:00:00Z',
      createdAt: '2024-12-31T23:45:00Z',
      revision: 1,
      offsets: { temperature_c: 0.1 },
      scales: { temperature_c: 1.01 },
      notes: 'Primary calibration',
      metadata: { source: 'lab' },
      checksum: 'abc123'
    }
  } satisfies Record<string, unknown>;

  const planMetadata = {
    planId: 'plan-001',
    state: 'pending',
    createdAt: '2025-01-02T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    partitionCount: 2,
    instrumentCount: 1,
    calibrationCount: 1,
    storage: {
      planPath: 'datasets/observatory/calibrations/plans/plan-001.json',
      nodeId: 42
    },
    calibrations: [
      {
        calibrationId: calibrationRecord.key,
        instrumentId: 'instrument_alpha',
        effectiveAt: '2025-01-01T00:00:00Z',
        metastoreVersion: 3,
        effectiveFromMinute: '2025-01-01T00:00',
        partitionCount: 2,
        stateCounts: { pending: 2 }
      }
    ],
    downstreamWorkflows: []
  } satisfies Record<string, unknown>;

  const planArtifact = {
    planId: 'plan-001',
    planVersion: 1,
    state: 'pending',
    createdAt: '2025-01-02T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    ingestWorkflowSlug: 'observatory-minute-ingest',
    ingestAssetId: 'observatory.reprocess.plan',
    downstreamWorkflows: [],
    calibrations: [
      {
        target: {
          calibrationId: calibrationRecord.key,
          instrumentId: 'instrument_alpha',
          effectiveAt: '2025-01-01T00:00:00Z',
          metastoreVersion: 3
        },
        requestedAt: '2025-01-02T00:00:00Z',
        effectiveFromMinute: '2025-01-01T00:00',
        partitions: [
          {
            partitionKey: '2025-01-01T00:00',
            minute: '2025-01-01T00:00',
            instrumentId: 'instrument_alpha',
            datasetSlug: 'observatory.timeseries',
            recordedCalibration: {
              calibrationId: calibrationRecord.key,
              instrumentId: 'instrument_alpha',
              effectiveAt: '2024-12-30T00:00:00Z',
              metastoreVersion: 2
            },
            target: {
              calibrationId: calibrationRecord.key,
              instrumentId: 'instrument_alpha',
              effectiveAt: '2025-01-01T00:00:00Z',
              metastoreVersion: 3
            },
            latestRun: null,
            parameters: null,
            status: {
              state: 'pending',
              runId: null,
              runStatus: null,
              runStartedAt: null,
              runCompletedAt: null,
              message: null,
              updatedAt: '2025-01-02T00:00:00Z',
              attempts: 0,
              lastErrorAt: null
            }
          },
          {
            partitionKey: '2025-01-01T00:01',
            minute: '2025-01-01T00:01',
            instrumentId: 'instrument_alpha',
            datasetSlug: 'observatory.timeseries',
            recordedCalibration: {
              calibrationId: calibrationRecord.key,
              instrumentId: 'instrument_alpha',
              effectiveAt: '2024-12-30T00:00:00Z',
              metastoreVersion: 2
            },
            target: {
              calibrationId: calibrationRecord.key,
              instrumentId: 'instrument_alpha',
              effectiveAt: '2025-01-01T00:00:00Z',
              metastoreVersion: 3
            },
            latestRun: null,
            parameters: null,
            status: {
              state: 'pending',
              runId: null,
              runStatus: null,
              runStartedAt: null,
              runCompletedAt: null,
              message: null,
              updatedAt: '2025-01-02T00:00:00Z',
              attempts: 0,
              lastErrorAt: null
            }
          }
        ],
        summary: {
          partitionCount: 2,
          stateCounts: { pending: 2 }
        }
      }
    ],
    summary: {
      partitionCount: 2,
      instrumentCount: 1,
      calibrationCount: 1,
      stateCounts: { pending: 2 }
    },
    storage: {
      planPath: 'datasets/observatory/calibrations/plans/plan-001.json',
      nodeId: 42
    },
    metadata: {}
  } satisfies Record<string, unknown>;

  metastoreMock
    .intercept({
      path: '/records/search',
      method: 'POST',
      body: /"namespace":"observatory\.calibrations"/
    })
    .reply(200, { records: [calibrationRecord] })
    .persist();

  metastoreMock
    .intercept({
      path: '/records/search',
      method: 'POST',
      body: /"namespace":"observatory\.reprocess\.plans"/
    })
    .reply(200, { records: [{ metadata: planMetadata }] })
    .persist();

  metastoreMock
    .intercept({
      path: '/records/observatory.reprocess.plans/plan-001',
      method: 'GET'
    })
    .reply(200, { record: { metadata: planMetadata, version: 1 } })
    .persist();

  metastoreMock
    .intercept({
      path: '/records/observatory.calibrations/' + encodeURIComponent(calibrationRecord.key as string),
      method: 'GET'
    })
    .reply(200, { record: { metadata: calibrationRecord.metadata, version: calibrationRecord.version } })
    .persist();

  filestoreMock
    .intercept({ path: '/v1/directories', method: 'POST' })
    .reply(200, {
      data: {
        idempotent: true,
        journalEntryId: 1,
        node: { id: 10, path: 'datasets/observatory/calibrations', backendMountId: 1, kind: 'directory' },
        result: {}
      }
    })
    .persist();

  let uploadedFiles = 0;
  filestoreMock
    .intercept({ path: '/v1/files', method: 'POST' })
    .reply(200, () => {
      uploadedFiles += 1;
      return {
        data: {
          idempotent: true,
          journalEntryId: 99,
          node: { id: 99, path: 'datasets/observatory/calibrations/instrument_alpha_20250101T000000Z.json' },
          result: {}
        }
      };
    })
    .persist();

  filestoreMock
    .intercept({ path: '/v1/files/42/content', method: 'GET' })
    .reply(200, JSON.stringify(planArtifact))
    .persist();

  const [{ buildServer }, { queueManager }] = await Promise.all([
    import('../src/server'),
    import('../src/queueManager')
  ]);

  const app = await buildServer();
  await app.ready();

  try {
    const authHeader = { authorization: 'Bearer ops-token' };

    const calibrationsResponse = await app.inject({
      method: 'GET',
      url: '/observatory/calibrations',
      headers: authHeader
    });
    assert.equal(calibrationsResponse.statusCode, 200);
    const calibrationsPayload = calibrationsResponse.json() as { data?: { calibrations: unknown[] } };
    assert(calibrationsPayload.data);
    assert.equal(calibrationsPayload.data?.calibrations.length, 1);

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/observatory/calibrations/upload',
      headers: { ...authHeader, 'content-type': 'application/json' },
      payload: {
        instrumentId: 'instrument_alpha',
        effectiveAt: '2025-01-01T00:00:00Z',
        createdAt: '2024-12-31T23:45:00Z',
        offsets: { temperature_c: 0.1 },
        metadata: { source: 'lab' }
      }
    });
    assert.equal(uploadResponse.statusCode, 201);
    assert.equal(uploadedFiles, 1, 'upload should write to filestore');

    const plansResponse = await app.inject({
      method: 'GET',
      url: '/observatory/plans',
      headers: authHeader
    });
    assert.equal(plansResponse.statusCode, 200);
    const plansPayload = plansResponse.json() as { data?: { plans: { planId: string }[] } };
    assert(plansPayload.data);
    assert.equal(plansPayload.data?.plans.length, 1);

   const planDetailResponse = await app.inject({
     method: 'GET',
     url: '/observatory/plans/plan-001',
     headers: authHeader
   });
    if (planDetailResponse.statusCode !== 200) {
      console.error('plan detail response', planDetailResponse.statusCode, planDetailResponse.body);
    }
    assert.equal(planDetailResponse.statusCode, 200);
    const planDetailPayload = planDetailResponse.json() as {
      data?: {
        plan: CalibrationReprocessPlan;
        computed: { partitionStateCounts: Record<string, number> };
      };
    };
    assert(planDetailPayload.data);
    assert.equal(planDetailPayload.data?.plan.calibrations[0]?.partitions.length, 2);
    assert.equal(planDetailPayload.data?.computed.partitionStateCounts.pending, 2);
  } finally {
    await app.close();
    await queueManager.closeConnection();
    await mockAgent.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
