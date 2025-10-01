import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleContext, createJobContext } from '../context';
import { defineModule } from '../module';
import { createModuleCapabilities } from '../runtime/capabilities';
import {
  createJobHandler,
  createService,
  createWorkflow,
  createWorkflowSchedule,
  createWorkflowTrigger
} from '../targets';

test('createModuleContext resolves defaults and merges overrides', () => {
  const context = createModuleContext<{ foo: string }, { secret?: string }>({
    module: { name: 'test', version: '1.0.0' },
    settingsDescriptor: {
      defaults: { foo: 'bar' }
    },
    secretsDescriptor: {
      defaults: { secret: 'xyz' }
    },
    capabilityConfig: {},
    capabilityOverrides: [
      {
        filestore: null
      }
    ]
  });

  assert.equal(context.module.name, 'test');
  assert.equal(context.settings.foo, 'bar');
  assert.equal(context.secrets.secret, 'xyz');
  assert.equal(context.capabilities.filestore, undefined);
});

test('createJobContext resolves parameter defaults', () => {
  const context = createJobContext<{ foo: string }, { secret?: string }, { limit: number }>({
    module: { name: 'test', version: '1.0.0' },
    job: { name: 'with-parameters' },
    settingsDescriptor: {
      defaults: { foo: 'bar' }
    },
    secretsDescriptor: {
      defaults: { secret: 'xyz' }
    },
    capabilityConfig: {},
    parametersDescriptor: {
      defaults: { limit: 5 }
    }
  });

  assert.equal(context.job.name, 'with-parameters');
  assert.equal(context.parameters.limit, 5);
  assert.equal(context.job.version, '1.0.0');
});

test('createModuleContext throws when required settings missing', () => {
  assert.throws(() => {
    createModuleContext({
      module: { name: 'broken', version: '0.0.1' },
      settingsDescriptor: undefined,
      capabilityConfig: {}
    });
  });
});

test('defineModule freezes metadata and keeps targets', () => {
  const job = createJobHandler({
    name: 'noop',
    handler: async (ctx) => ctx.logger.info('noop')
  });
  const module = defineModule({
    metadata: { name: 'noop-module', version: '1.0.0' },
    targets: [job]
  });
  assert.ok(Object.isFrozen(module));
  assert.equal(module.targets.length, 1);
  assert.equal(module.targets[0].version, '1.0.0');
});

test('defineModule keeps explicit target versions', () => {
  const versionedJob = createJobHandler({
    name: 'versioned',
    version: '1.2.3',
    handler: async (ctx) => ctx.logger.info('versioned')
  });

  const module = defineModule({
    metadata: { name: 'versioned-module', version: '1.0.0' },
    targets: [versionedJob]
  });

  assert.equal(module.targets[0].version, '1.2.3');
});

test('defineModule rejects invalid target versions', () => {
  const invalidJob = createJobHandler({
    name: 'invalid-version',
    version: 'not-a-semver',
    handler: async (ctx) => ctx.logger.info('invalid')
  });

  assert.throws(() => {
    defineModule({
      metadata: { name: 'invalid-module', version: '1.0.0' },
      targets: [invalidJob]
    });
  }, /must be a valid semver string/);
});

test('defineModule rejects invalid module versions', () => {
  const job = createJobHandler({
    name: 'noop',
    handler: async (ctx) => ctx.logger.info('noop')
  });

  assert.throws(() => {
    defineModule({
      metadata: { name: 'bad-module', version: 'vNext' },
      targets: [job]
    });
  }, /must be a valid semver string/);
});

test('createService returns service definition with handler', () => {
  const definition = createService({
    name: 'dashboard',
    handler: async (ctx) => {
      ctx.logger.info('service start');
      return {
        async start() {
          ctx.logger.info('started');
        }
      };
    }
  });

  assert.equal(definition.kind, 'service');
  assert.equal(definition.name, 'dashboard');
  assert.ok(typeof definition.handler === 'function');
});

test('createWorkflow normalizes triggers and schedules', () => {
  const workflow = createWorkflow({
    name: 'observatory-dashboard-aggregate',
    description: 'Aggregates dashboards',
    definition: {
      slug: 'observatory-dashboard-aggregate',
      steps: []
    },
    triggers: [
      createWorkflowTrigger({
        name: 'partition-ready',
        eventType: 'observatory.minute.partition-ready',
        predicates: [
          {
            path: 'payload.datasetSlug',
            operator: 'equals',
            value: 'observatory-timeseries'
          }
        ],
        throttle: {
          windowMs: 60000,
          count: 5
        }
      }),
      {
        name: 'raw-uploaded-fallback',
        eventType: 'observatory.minute.raw-uploaded'
      }
    ],
    schedules: [
      createWorkflowSchedule({
        name: 'hourly',
        cron: '0 * * * *',
        enabled: true
      }),
      {
        name: 'daily',
        cron: '0 6 * * *'
      }
    ]
  });

  assert.equal(workflow.kind, 'workflow');
  assert.equal(workflow.triggers?.length, 2);
  assert.equal(workflow.schedules?.length, 2);
  assert.deepEqual(workflow.triggers?.[0].predicates?.length, 1);
});

test('createModuleCapabilities respects empty configuration', () => {
  const capabilities = createModuleCapabilities({});
  assert.equal(capabilities.filestore, undefined);
  assert.equal(capabilities.metastore, undefined);
  assert.equal(capabilities.timestore, undefined);
  assert.equal(capabilities.events, undefined);
  assert.equal(capabilities.coreHttp, undefined);
});
