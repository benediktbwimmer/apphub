import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleSetting, moduleSecret, capability } from '../templates';

test('template helpers render module references', () => {
  assert.equal(moduleSetting('core.baseUrl'), '{{ module.settings.core.baseUrl }}');
  assert.equal(moduleSecret('api.token'), '{{ module.secrets.api.token }}');
  assert.equal(capability('events.notifications'), '{{ module.capabilities.events.notifications }}');
});
