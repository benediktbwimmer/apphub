import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ApiAccessPage from '../ApiAccessPage';
import type { AuthContextValue, CreateApiKeyResult } from '../../auth/context';

vi.mock('../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => vi.fn(() => Promise.resolve(new Response(null, { status: 200 })))
}));

let authContextValue: AuthContextValue;

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => authContextValue
}));

describe('ApiAccessPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authContextValue = {
      identity: {
        subject: 'user-123',
        kind: 'user',
        scopes: [
          'filestore:admin',
          'filestore:read',
          'filestore:write',
          'metastore:read'
        ],
        authDisabled: false,
        userId: 'user-123',
        sessionId: 'session-abc',
        apiKeyId: null,
        displayName: 'Test User',
        email: 'user@example.com',
        roles: []
      },
      identityLoading: false,
      identityError: null,
      refreshIdentity: vi.fn(async () => undefined),
      apiKeys: [],
      apiKeysLoading: false,
      apiKeysError: null,
      refreshApiKeys: vi.fn(async () => undefined),
      createApiKey: vi.fn(async () =>
        ({
          key: {
            id: 'key-1',
            name: 'Test key',
            prefix: 'test',
            scopes: ['filestore:read'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastUsedAt: null,
            expiresAt: null,
            revokedAt: null
          },
          token: 'secret'
        }) satisfies CreateApiKeyResult
      ),
      revokeApiKey: vi.fn(async () => undefined),
      activeToken: 'token',
      setActiveToken: vi.fn()
    } satisfies AuthContextValue;
  });

  it('renders filestore scopes alphabetically with descriptions', () => {
    render(<ApiAccessPage />);

    const admin = screen.getByText('Administer filestore');
    const read = screen.getByText('Read filestore nodes');
    const write = screen.getByText('Write filestore nodes');

    expect(admin.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(read.compareDocumentPosition(write) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(
      screen.getByText('Inspect directories and node metadata across backends.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Create directories, update metadata, and prune nodes.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Trigger reconciliations, enforce consistency, and manage backends.')
    ).toBeInTheDocument();
  });
});
