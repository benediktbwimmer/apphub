import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleContext } from '../context';
import { defineModule } from '../module';
import { createModuleCapabilities } from '../runtime/capabilities';
import { createJobHandler } from '../targets';

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
});

test('createModuleCapabilities respects empty configuration', () => {
  const capabilities = createModuleCapabilities({});
  assert.equal(capabilities.filestore, undefined);
  assert.equal(capabilities.metastore, undefined);
  assert.equal(capabilities.timestore, undefined);
  assert.equal(capabilities.events, undefined);
  assert.equal(capabilities.coreHttp, undefined);
});
