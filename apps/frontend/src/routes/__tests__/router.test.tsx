import { describe, expect, it, vi } from 'vitest';
import { appRouteConfig } from '../router';
import { ROUTE_SEGMENTS } from '../paths';

vi.mock('reactflow', () => ({}));
vi.mock('../../dataAssets/AssetsPage', () => ({ default: () => null }));

describe('appRouteConfig', () => {
  it('registers canonical top-level routes', () => {
    const root = appRouteConfig.find((route) => route.path === '/');
    expect(root).toBeTruthy();
    const childPaths = new Set((root?.children ?? []).map((child) => (child.index ? 'index' : child.path)));

    expect(childPaths.has('index')).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.catalog)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.events)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.services)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.workflows)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.topology)).toBe(true);
    expect(childPaths.has(ROUTE_SEGMENTS.settings)).toBe(true);
    expect(childPaths.has('submit')).toBe(true);
    expect(childPaths.has('import-manifest')).toBe(true);
  });

  it('nests services routes under the services layout', () => {
    const root = appRouteConfig.find((route) => route.path === '/');
    const servicesRoute = root?.children?.find((child) => child.path === ROUTE_SEGMENTS.services);
    expect(servicesRoute).toBeTruthy();
    expect(servicesRoute?.element).toBeTruthy();
    expect(servicesRoute?.errorElement).toBeTruthy();

    const serviceChildren = servicesRoute?.children ?? [];
    const childSegments = new Set(
      serviceChildren.map((child) => (child.index ? 'index' : child.path))
    );
    expect(childSegments.has('index')).toBe(true);
    expect(childSegments.has(ROUTE_SEGMENTS.servicesOverview)).toBe(true);
    expect(childSegments.has(ROUTE_SEGMENTS.servicesTimestore)).toBe(true);
    expect(childSegments.has(ROUTE_SEGMENTS.servicesMetastore)).toBe(true);
  });

  it('nests settings routes including appearance and import', () => {
    const root = appRouteConfig.find((route) => route.path === '/');
    const settingsRoute = root?.children?.find((child) => child.path === ROUTE_SEGMENTS.settings);
    expect(settingsRoute).toBeTruthy();
    const settingsChildren = settingsRoute?.children ?? [];
    const childSegments = new Set(settingsChildren.map((child) => (child.index ? 'index' : child.path)));
    expect(childSegments.has(ROUTE_SEGMENTS.settingsAppearance)).toBe(true);
    expect(childSegments.has(ROUTE_SEGMENTS.settingsImport)).toBe(true);
  });
});
