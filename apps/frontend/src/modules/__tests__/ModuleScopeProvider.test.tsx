import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import type { AuthContextValue, AuthIdentity } from '../../auth/context';

const fetchModulesMock = vi.fn();
const fetchModuleResourcesMock = vi.fn();

vi.mock('../api', () => ({
  fetchModules: fetchModulesMock,
  fetchModuleResources: fetchModuleResourcesMock
}));

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: vi.fn()
}));

vi.mock('../../auth/useAuth', () => ({
  useAuth: vi.fn()
}));

vi.mock('../../events/context', () => ({
  useAppHubEvent: vi.fn()
}));

type ModuleScopeProviderType = typeof import('../ModuleScopeProvider')['ModuleScopeProvider'];

let ModuleScopeProvider: ModuleScopeProviderType;
let useAuthorizedFetchMock: Mock;
let useAuthMock: Mock;

beforeAll(async () => {
  ({ ModuleScopeProvider } = await import('../ModuleScopeProvider'));
  const authorizedFetchModule = await import('../../auth/useAuthorizedFetch');
  const authModule = await import('../../auth/useAuth');
  useAuthorizedFetchMock = authorizedFetchModule.useAuthorizedFetch as unknown as Mock;
  useAuthMock = authModule.useAuth as unknown as Mock;
});

function makeIdentity(overrides: Partial<AuthIdentity> = {}): AuthIdentity {
  return {
    subject: 'test',
    kind: 'user',
    scopes: [],
    authDisabled: false,
    userId: null,
    sessionId: null,
    apiKeyId: null,
    displayName: null,
    email: null,
    roles: [],
    ...overrides
  };
}

function makeAuthContext(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
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
    setActiveToken: vi.fn(),
    ...overrides
  };
}

describe('ModuleScopeProvider', () => {
function renderProvider(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/"
          element={
            <ModuleScopeProvider>
              <Outlet />
            </ModuleScopeProvider>
          }
        >
          <Route path="*" element={<div />} />
          <Route path="modules/:moduleId/*" element={<div />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

  beforeEach(() => {
    fetchModulesMock.mockReset();
    fetchModuleResourcesMock.mockReset();
    useAuthorizedFetchMock.mockReset();
    useAuthMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches modules when auth is disabled without a bearer token', async () => {
    const authorizedFetcher = Object.assign(vi.fn(), { authToken: null });
    useAuthorizedFetchMock.mockReturnValue(authorizedFetcher);
    useAuthMock.mockReturnValue(
      makeAuthContext({
        identity: makeIdentity({ authDisabled: true })
      })
    );
    fetchModulesMock.mockResolvedValue([
      {
        id: 'observatory',
        displayName: 'Observatory',
        description: null,
        keywords: [],
        latestVersion: null,
        createdAt: 'now',
        updatedAt: 'now'
      }
    ]);

    renderProvider();

    await waitFor(() => expect(fetchModulesMock).toHaveBeenCalledTimes(1));
    expect(fetchModulesMock).toHaveBeenCalledWith(authorizedFetcher, expect.any(Object));
  });

  it('skips loading modules when authentication is required and no token is available', async () => {
    const authorizedFetcher = Object.assign(vi.fn(), { authToken: null });
    useAuthorizedFetchMock.mockReturnValue(authorizedFetcher);
    useAuthMock.mockReturnValue(
      makeAuthContext({
        identity: null
      })
    );

    renderProvider();

    await waitFor(() => {
      expect(fetchModulesMock).not.toHaveBeenCalled();
    });
  });

  it('fetches module resources when a module route is active and auth is disabled', async () => {
    const authorizedFetcher = Object.assign(vi.fn(), { authToken: null });
    useAuthorizedFetchMock.mockReturnValue(authorizedFetcher);
    useAuthMock.mockReturnValue(
      makeAuthContext({
        identity: makeIdentity({ authDisabled: true })
      })
    );

    fetchModulesMock.mockResolvedValue([]);
    fetchModuleResourcesMock.mockResolvedValue({
      moduleId: 'observatory',
      resourceType: null,
      resources: []
    });

    renderProvider('/modules/observatory');

    await waitFor(() => expect(fetchModulesMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(fetchModuleResourcesMock).toHaveBeenCalledWith(authorizedFetcher, 'observatory', expect.any(Object))
    );
  });
});
