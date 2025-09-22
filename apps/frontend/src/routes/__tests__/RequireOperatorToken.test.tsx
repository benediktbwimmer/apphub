import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RequireOperatorToken } from '../RequireOperatorToken';
import { ApiTokenProvider } from '../../auth/ApiTokenContext';
import { ToastProvider } from '../../components/toast';
import { ROUTE_PATHS } from '../paths';

describe('RequireOperatorToken', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated users to the API access page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={[ROUTE_PATHS.workflows]}>
        <ToastProvider>
          <ApiTokenProvider>
            <Routes>
              <Route
                path={ROUTE_PATHS.workflows}
                element={
                  <RequireOperatorToken>
                    <div>Guarded content</div>
                  </RequireOperatorToken>
                }
              />
              <Route path={ROUTE_PATHS.apiAccess} element={<div>API Access Portal</div>} />
            </Routes>
          </ApiTokenProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('API Access Portal')).toBeInTheDocument());
  });

  it('renders children when an operator token is present', async () => {
    const now = new Date().toISOString();
    window.localStorage.setItem(
      'apphub.apiTokens.v1',
      JSON.stringify([{ id: 'token-1', label: 'Test', token: 'abc123', createdAt: now, lastUsedAt: null }])
    );

    render(
      <MemoryRouter initialEntries={[ROUTE_PATHS.import]}>
        <ToastProvider>
          <ApiTokenProvider>
            <Routes>
              <Route
                path={ROUTE_PATHS.import}
                element={
                  <RequireOperatorToken>
                    <div>Operator content</div>
                  </RequireOperatorToken>
                }
              />
            </Routes>
          </ApiTokenProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Operator content')).toBeInTheDocument());
  });
});
