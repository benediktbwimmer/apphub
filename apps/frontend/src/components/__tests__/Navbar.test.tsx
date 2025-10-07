import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Navbar from '../Navbar';
import { PRIMARY_NAV_ITEMS } from '../../routes/paths';
import { ModuleScopeContextProvider, type ModuleScopeContextValue } from '../../modules/ModuleScopeContext';
import type { ReactNode } from 'react';

const moduleScopeStub: ModuleScopeContextValue = {
  kind: 'module',
  moduleId: 'test-module',
  moduleVersion: '1.0.0',
  modules: [],
  loadingModules: false,
  modulesError: null,
  resources: [],
  loadingResources: false,
  resourcesError: null,
  setModuleId: vi.fn(),
  buildModulePath: (path: string) => path,
  stripModulePrefix: (pathname: string) => pathname,
  getResourceContexts: () => [],
  getResourceIds: () => [],
  getResourceSlugs: () => [],
  isResourceInScope: () => true
};

function renderWithModuleScope(ui: ReactNode) {
  return render(
    <ModuleScopeContextProvider value={moduleScopeStub}>
      {ui}
    </ModuleScopeContextProvider>
  );
}

describe('Navbar', () => {
  it('renders the sidebar navigation with icon links and highlights the active route', () => {
    renderWithModuleScope(
      <MemoryRouter initialEntries={['/services']}>
        <Navbar />
      </MemoryRouter>
    );

    const nav = screen.getByRole('navigation', { name: /primary/i });
    expect(nav).toBeInTheDocument();

    PRIMARY_NAV_ITEMS.forEach((item) => {
      const link = screen.getByRole('link', { name: item.label });
      expect(link).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Services' })).toHaveAttribute('aria-current', 'page');
  });

  it('retains the overlay variant for fullscreen previews', () => {
    renderWithModuleScope(
      <MemoryRouter initialEntries={['/overview']}>
        <Navbar variant="overlay" />
      </MemoryRouter>
    );

    const tablist = screen.getByRole('tablist', { name: 'Pages' });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
});
