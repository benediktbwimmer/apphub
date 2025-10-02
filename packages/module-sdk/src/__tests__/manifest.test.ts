import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeModuleDefinition } from '../manifest';
import { defineModule } from '../module';
import {
  createJobHandler,
  createService,
  createWorkflow,
  createWorkflowSchedule,
  createWorkflowTrigger
} from '../targets';

type ModuleSettings = {
  foo: string;
};

type ModuleSecrets = {
  token: string;
};

test('serializeModuleDefinition captures targets and descriptors', () => {
  const job = createJobHandler<ModuleSettings, ModuleSecrets, void, { limit: number }>({
    name: 'generator',
    version: '2.0.0',
    parameters: {
      defaults: { limit: 5 },
      resolve: (raw) => ({ limit: Number((raw as { limit?: number } | undefined)?.limit ?? 5) })
    },
    capabilityOverrides: {
      filestore: null,
      metastore: null
    },
    handler: async () => undefined
  });

  const service = createService<ModuleSettings, ModuleSecrets>({
    name: 'dashboard',
    version: '1.0.1',
    registration: {
      slug: 'observatory-dashboard',
      kind: 'dashboard',
      healthEndpoint: '/healthz',
      defaultPort: 4311,
      basePath: '/',
      tags: ['observatory', 'dashboard'],
      env: {
        HOST: '0.0.0.0',
        PORT: '{{port}}'
      },
      ui: {
        previewPath: '/',
        spa: true
      }
    },
    handler: async () => ({
      async start() {
        return undefined;
      }
    })
  });

  const workflow = createWorkflow<ModuleSettings, ModuleSecrets>({
    name: 'observatory-minute-ingest',
    version: '1.1.0',
    definition: {
      slug: 'observatory-minute-ingest',
      steps: []
    },
    triggers: [
      createWorkflowTrigger({
        name: 'minute-ready',
        eventType: 'observatory.minute.ready'
      })
    ],
    schedules: [
      createWorkflowSchedule({
        name: 'hourly',
        cron: '0 * * * *'
      })
    ]
  });

  const moduleDef = defineModule<ModuleSettings, ModuleSecrets>({
    metadata: {
      name: 'observatory',
      version: '3.0.0'
    },
    settings: {
      defaults: { foo: 'bar' },
      resolve: (raw) => ({ foo: (raw as ModuleSettings | null | undefined)?.foo ?? 'bar' })
    },
    secrets: {
      defaults: { token: 'secret' }
    },
    capabilities: {
      filestore: {
        baseUrl: 'http://127.0.0.1:4300',
        backendMountId: 1
      }
    },
    targets: [job, service, workflow]
  });

  const manifest = serializeModuleDefinition(moduleDef);

  assert.equal(manifest.metadata.name, 'observatory');
  assert.equal(manifest.metadata.version, '3.0.0');
  assert.deepEqual(manifest.configuredCapabilities, ['filestore']);
  assert.equal(manifest.settings?.hasResolve, true);
  assert.equal(manifest.secrets?.hasResolve, false);

  const jobTarget = manifest.targets.find((target) => target.name === 'generator');
  assert.ok(jobTarget);
  assert.equal(jobTarget?.kind, 'job');
  assert.equal(jobTarget?.version, '2.0.0');
  assert.equal(jobTarget?.fingerprint, '3.0.0:2.0.0:generator');
  assert.equal(jobTarget?.parameters?.hasResolve, true);
  assert.deepEqual(jobTarget?.capabilityOverrides, ['filestore', 'metastore']);

  const workflowTarget = manifest.targets.find((target) => target.kind === 'workflow');
  assert.ok(workflowTarget);
  assert.equal(workflowTarget?.workflow?.triggers.length, 1);
  assert.equal(workflowTarget?.workflow?.schedules.length, 1);

  const serviceTarget = manifest.targets.find((target) => target.kind === 'service');
  assert.ok(serviceTarget);
  assert.equal(serviceTarget?.version, '1.0.1');
  assert.equal(serviceTarget?.fingerprint, '3.0.0:1.0.1:dashboard');
  assert.equal(
    (serviceTarget?.service?.registration as { slug?: string } | undefined)?.slug,
    'observatory-dashboard'
  );
  assert.deepEqual(
    (serviceTarget?.service?.registration as { tags?: string[] } | undefined)?.tags,
    ['observatory', 'dashboard']
  );
});
