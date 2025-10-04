import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptorFromParser, zodDescriptor, jsonDescriptor } from '../descriptors';

const noopSchema = {
  parse(value: unknown) {
    if (typeof value !== 'string') {
      throw new Error('expected string');
    }
    return value.trim();
  }
};

test('descriptorFromParser uses defaults when raw value missing', () => {
  const descriptor = descriptorFromParser((value) => String(value), { defaults: 'hello' });
  assert.equal(descriptor.defaults, 'hello');
  assert.equal(descriptor.resolve?.(undefined), 'hello');
  assert.equal(descriptor.resolve?.('world'), 'world');
});

test('zodDescriptor delegates to parser', () => {
  const descriptor = zodDescriptor(noopSchema, { defaults: 'fallback' });
  assert.equal(descriptor.defaults, 'fallback');
  assert.equal(descriptor.resolve?.(' test '), 'test');
});

test('jsonDescriptor returns raw value when provided', () => {
  const descriptor = jsonDescriptor<{ foo: number }>({ defaults: { foo: 1 } });
  assert.deepEqual(descriptor.defaults, { foo: 1 });
  assert.deepEqual(descriptor.resolve?.({ foo: 2 }), { foo: 2 });
});
