import { describe, expect, test } from 'vitest';
import { defineModuleSecurity } from '../src/index';

describe('defineModuleSecurity', () => {
  test('returns typed principal handles with literal value builders', () => {
    const security = defineModuleSecurity<{ timestoreToken?: string }>({
      principals: {
        dashboardAggregator: {
          subject: 'observatory-dashboard-aggregator',
          description: 'Runs dashboard aggregation jobs'
        },
        timestoreLoader: {
          subject: 'observatory-timestore-loader'
        }
      },
      secrets: {
        timestoreToken: {
          select: (secrets) => secrets.timestoreToken,
          required: false
        }
      }
    });

    const principal = security.principal('dashboardAggregator');
    expect(principal.subject).toBe('observatory-dashboard-aggregator');
    const compiled = principal.asValueBuilder().build({ settings: undefined });
    expect(compiled.type).toBe('literal');
    if (compiled.type === 'literal') {
      expect(compiled.value).toBe('observatory-dashboard-aggregator');
    }

    // list helpers
    expect(security.listPrincipals()).toHaveLength(2);
    const bundle = security.secretsBundle({ timestoreToken: 'abc' });
    expect(bundle.timestoreToken.value()).toBe('abc');
    expect(bundle.timestoreToken.exists()).toBe(true);
  });

  test('secret handles provide optional accessors and enforce required values', () => {
    const security = defineModuleSecurity<{ timestoreToken?: string | null }>({
      principals: {},
      secrets: {
        timestoreToken: {
          select: (secrets) => secrets.timestoreToken,
          required: true
        }
      }
    });

    const handle = security.secret('timestoreToken');
    expect(handle.get({ timestoreToken: 'abc' })).toBe('abc');
    expect(() => handle.require({ timestoreToken: undefined })).toThrow(
      /Secret 'timestoreToken' is required/
    );
  });
});
