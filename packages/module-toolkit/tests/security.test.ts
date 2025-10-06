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
    expect(security.principalSubjects()).toEqual({
      dashboardAggregator: 'observatory-dashboard-aggregator',
      timestoreLoader: 'observatory-timestore-loader'
    });
    expect(security.principalSettings({ dashboardAggregator: 'override' })).toEqual({
      dashboardAggregator: 'override',
      timestoreLoader: 'observatory-timestore-loader'
    });
    expect(security.principalSettingsPath('dashboardAggregator')).toBe('principals.dashboardAggregator');
    const selector = security.principalSelector<'dashboardAggregator'>('dashboardAggregator');
    expect(
      selector({
        principals: { dashboardAggregator: 'observatory-dashboard-aggregator' }
      })
    ).toBe('observatory-dashboard-aggregator');
    expect(security.secretSettingsPath('timestoreToken')).toBe('secrets.timestoreToken');
    const secretSelector = security.secretSelector('timestoreToken');
    expect(secretSelector({ timestoreToken: 'abc' })).toBe('abc');
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
