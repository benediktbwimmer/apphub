import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PropsWithChildren } from 'react';
import { RequireOperatorToken } from '../RequireOperatorToken';
import { ToastProvider } from '../../components/toast';
import { ROUTE_PATHS } from '../paths';
import { useAuth } from '../../auth/useAuth';

vi.mock('../../auth/useAuth', () => {
  const useAuthMock = vi.fn();
  const AuthProviderMock = ({ children }: PropsWithChildren<unknown>) => <>{children}</>;
  return {
    useAuth: useAuthMock,
    AuthProvider: AuthProviderMock
  };
});

const mockedUseAuth = useAuth as unknown as vi.Mock;

describe('RequireOperatorToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated users to the settings API access page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockedUseAuth.mockReturnValue({
      identity: null,
      identityLoading: false,
      identityError: null,
      refreshIdentity: vi.fn(),
      apiKeys: [],
      apiKeysLoading: false,
      apiKeysError: null,
      refreshApiKeys: vi.fn(),
      createApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      activeToken: null,
      setActiveToken: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={[ROUTE_PATHS.workflows]}>
        <ToastProvider>
          <Routes>
            <Route
              path={ROUTE_PATHS.workflows}
              element={
                <RequireOperatorToken>
                  <div>Guarded content</div>
                </RequireOperatorToken>
              }
            />
            <Route path={ROUTE_PATHS.settingsApiAccess} element={<div>API Access Portal</div>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('API Access Portal')).toBeInTheDocument());
  });

  it('renders children when an operator token is present', async () => {
    mockedUseAuth.mockReturnValue({
      identity: {
        subject: 'user@example.com',
        kind: 'user',
        scopes: ['workflows:run'],
        userId: 'usr_1',
        sessionId: 'sess_1',
        apiKeyId: null,
        displayName: 'Test User',
        email: 'user@example.com',
        roles: ['viewer']
      },
      identityLoading: false,
      identityError: null,
      refreshIdentity: vi.fn(),
      apiKeys: [],
      apiKeysLoading: false,
      apiKeysError: null,
      refreshApiKeys: vi.fn(),
      createApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      activeToken: null,
      setActiveToken: vi.fn()
    });

    render(
      <MemoryRouter initialEntries={[ROUTE_PATHS.import]}>
        <ToastProvider>
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
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Operator content')).toBeInTheDocument());
  });
});
