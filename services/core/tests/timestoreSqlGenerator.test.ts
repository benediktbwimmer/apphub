import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTimestoreSql,
  sanitizeGeneratedSql,
  validateGeneratedSql,
  stripCodeFences,
  type TimestoreSqlGenerationDeps
} from '../src/ai/timestoreSqlGenerator';

describe('Timestore SQL generator helpers', () => {
  it('strips markdown fences from SQL', () => {
    const input = '```sql\nSELECT * FROM datasets;\n```';
    const result = stripCodeFences(input);
    assert.equal(result, 'SELECT * FROM datasets;');
  });

  it('sanitizes trailing semicolons and whitespace', () => {
    const sanitized = sanitizeGeneratedSql('SELECT 1;   ');
    assert.equal(sanitized, 'SELECT 1');
  });

  it('rejects non-read-only statements', () => {
    assert.throws(() => validateGeneratedSql('DELETE FROM datasets'), /start with select or with/i);
    assert.throws(() => validateGeneratedSql('SELECT 1; SELECT 2'), /single statement/i);
  });
});

describe('generateTimestoreSql', () => {
  const schema = {
    tables: [
      {
        name: 'timestore_runtime.datasets',
        description: 'Datasets registered in Timestore',
        columns: [
          { name: 'dataset_slug', type: 'VARCHAR' },
          { name: 'created_at', type: 'TIMESTAMP' }
        ]
      }
    ]
  };

  it('returns sanitized output for OpenAI provider', async () => {
    const deps: TimestoreSqlGenerationDeps = {
      runOpenAi: async () => ({
        output: JSON.stringify({
          sql: '```sql\nSELECT dataset_slug FROM timestore_runtime.datasets;\n```',
          notes: 'Lists datasets'
        }),
        summary: null
      }),
      runOpenRouter: async () => {
        throw new Error('Unexpected OpenRouter call');
      }
    };

    const result = await generateTimestoreSql(
      {
        prompt: 'List all dataset slugs.',
        schema,
        provider: 'openai',
        providerOptions: {
          openAiApiKey: 'sk-test-123'
        }
      },
      deps
    );

    assert.equal(result.sql, 'SELECT dataset_slug FROM timestore_runtime.datasets');
    assert.equal(result.notes, 'Lists datasets');
    assert.equal(result.provider, 'openai');
    assert.deepEqual(result.warnings, []);
  });

  it('requires credentials for OpenRouter', async () => {
    const deps: TimestoreSqlGenerationDeps = {
      runOpenAi: async () => {
        throw new Error('Unexpected OpenAI call');
      },
      runOpenRouter: async () => ({ output: '{}', summary: null })
    };

    await assert.rejects(
      () =>
        generateTimestoreSql(
          {
            prompt: 'List datasets.',
            schema,
            provider: 'openrouter',
            providerOptions: {}
          },
          deps
        ),
      /OpenRouter API key is required/i
    );
  });
});
