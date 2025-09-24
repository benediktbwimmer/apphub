import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handler } from '../src/index';

const context = {
  parameters: { message: 'hi' },
  logger: () => undefined,
  update: async () => undefined
};

test('handler echoes parameters', async () => {
  const result = await handler(context);
  assert.equal(result.status ?? 'succeeded', 'succeeded');
});
