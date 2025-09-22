import { describe, expect, it } from 'vitest';
import { appRouteConfig } from '../router';
import { ROUTE_SEGMENTS } from '../paths';

describe('appRouteConfig', () => {
  it('registers canonical top-level routes', () => {
    const root = appRouteConfig.find((route) => route.path === '/');
    expect(root).toBeTruthy();
    const childPaths = new Set((root?.children ?? []).map((child) => (child.index ? 'index' : child.path)));

    expect(childPaths.has('index')).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.catalog)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.apps)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.workflows)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.import)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.apiAccess)).toBe(true);
    expect(childPaths.has('submit')).toBe(true);
    expect(childPaths.has('import-manifest')).toBe(true);
  });
});
