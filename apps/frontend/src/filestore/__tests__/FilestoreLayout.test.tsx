import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FilestoreLayout from '../FilestoreLayout';
import type { AuthContextValue } from '../../auth/context';

let authContextValue: AuthContextValue;

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => authContextValue
}));

vi.mock('../FilestoreExplorerPage', () => ({
  __esModule: true,
  default: () => <div data-testid="filestore-explorer-stub">Explorer stub</div>
}));

describe('FilestoreLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextValue = {
      identity: null,
      identityLoading: false,
      identityError: null,
      refreshIdentity: vi.fn(async () => undefined),
      apiKeys: [],
      apiKeysLoading: false,
      apiKeysError: null,
      refreshApiKeys: vi.fn(async () => undefined),
      createApiKey: vi.fn(),
      revokeApiKey: vi.fn(),
      activeToken: null,
      setActiveToken: vi.fn()
    };
  });

  it('shows a loading state while identity resolves', () => {
    authContextValue.identityLoading = true;
    render(<FilestoreLayout />);

    expect(screen.getByText('Loading filestore access…')).toBeInTheDocument();
  });

  it('renders an access warning without filestore scopes', () => {
    authContextValue.identity = {
      subject: 'user-1',
      kind: 'user',
      scopes: ['metastore:read'],
      authDisabled: false,
      userId: 'user-1',
      sessionId: 'session',
      apiKeyId: null,
      displayName: 'User',
      email: 'user@example.com',
      roles: []
    };

    render(<FilestoreLayout />);

    expect(screen.getByText('Filestore access required')).toBeInTheDocument();
    expect(screen.getByText(/filestore:read/)).toBeInTheDocument();
  });

  it('renders the explorer view when scopes are granted', () => {
    authContextValue.identity = {
      subject: 'user-1',
      kind: 'user',
      scopes: ['filestore:read'],
      authDisabled: false,
      userId: 'user-1',
      sessionId: 'session',
      apiKeyId: null,
      displayName: 'User',
      email: 'user@example.com',
      roles: []
    };

    render(<FilestoreLayout />);

    expect(screen.getByTestId('filestore-explorer-stub')).toBeInTheDocument();
  });
});
