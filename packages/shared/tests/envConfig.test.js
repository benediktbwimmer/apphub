const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const {
  loadEnvConfig,
  EnvConfigError,
  booleanVar,
  integerVar,
  stringSetVar,
  numberVar
} = require('../dist/envConfig.js');

test('booleanVar handles truthy and falsy values', () => {
  const schema = z
    .object({
      FEATURE_FLAG: booleanVar({ defaultValue: false })
    })
    .passthrough()
    .transform((input) => input.FEATURE_FLAG);

  const truthy = loadEnvConfig(schema, {
    env: { FEATURE_FLAG: 'YES' },
    context: 'boolean-test'
  });
  assert.equal(truthy, true);

  const falsy = loadEnvConfig(schema, {
    env: { FEATURE_FLAG: 'off' },
    context: 'boolean-test'
  });
  assert.equal(falsy, false);

  const fallback = loadEnvConfig(schema, {
    env: {},
    context: 'boolean-test'
  });
  assert.equal(fallback, false);
});

test('integerVar enforces boundaries and parses defaults', () => {
  const schema = z
    .object({
      MAX_CONNECTIONS: integerVar({ defaultValue: 5, min: 1, max: 10 })
    })
    .passthrough()
    .transform((input) => input.MAX_CONNECTIONS);

  const parsed = loadEnvConfig(schema, {
    env: { MAX_CONNECTIONS: '8' },
    context: 'integer-test'
  });
  assert.equal(parsed, 8);

  const defaulted = loadEnvConfig(schema, {
    env: {},
    context: 'integer-test'
  });
  assert.equal(defaulted, 5);

  assert.throws(
    () =>
      loadEnvConfig(schema, {
        env: { MAX_CONNECTIONS: '999' },
        context: 'integer-test'
      }),
    (error) => {
      assert(error instanceof EnvConfigError);
      assert.match(error.message, /integer-test/);
      assert.match(error.message, /MAX_CONNECTIONS/);
      return true;
    }
  );
});

test('stringSetVar normalizes values and removes duplicates', () => {
  const schema = z
    .object({
      ALLOWED_DOMAINS: stringSetVar({ lowercase: true, unique: true })
    })
    .passthrough()
    .transform((input) => input.ALLOWED_DOMAINS);

  const result = loadEnvConfig(schema, {
    env: { ALLOWED_DOMAINS: 'Example.com, foo.com, example.com' },
    context: 'set-test'
  });

  assert.deepEqual(Array.from(result), ['example.com', 'foo.com']);
});

test('loadEnvConfig surfaces consistent error formatting', () => {
  const schema = z
    .object({
      REQUIRED_FLAG: booleanVar({ required: true })
    })
    .passthrough();

  assert.throws(
    () =>
      loadEnvConfig(schema, {
        env: { REQUIRED_FLAG: 'maybe' },
        context: 'core-auth'
      }),
    (error) => {
      assert(error instanceof EnvConfigError);
      assert.match(error.message, /\[core-auth\]/);
      assert.match(error.message, /REQUIRED_FLAG/);
      assert.match(error.message, /Invalid/);
      return true;
    }
  );
});

test('numberVar accepts floats and applies defaults', () => {
  const schema = z
    .object({
      RETRY_DELAY: numberVar({ defaultValue: 1.5, min: 0 })
    })
    .passthrough()
    .transform((input) => input.RETRY_DELAY);

  const parsed = loadEnvConfig(schema, {
    env: { RETRY_DELAY: '2.25' },
    context: 'number-test'
  });
  assert.equal(parsed, 2.25);

  const defaulted = loadEnvConfig(schema, {
    env: {},
    context: 'number-test'
  });
  assert.equal(defaulted, 1.5);
});

