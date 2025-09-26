import { createHash } from 'node:crypto';
import type { TokenDefinition, TokenScope } from '../config/serviceConfig';

const ALL_SCOPES: TokenScope[] = [
  'metastore:read',
  'metastore:write',
  'metastore:delete',
  'metastore:admin'
];

export type AuthIdentity = {
  subject: string;
  kind: 'user' | 'service';
  scopes: Set<TokenScope>;
  namespaces: Set<string> | '*';
  tokenHash: string;
  authDisabled: boolean;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toScopeSet(definition: TokenDefinition): Set<TokenScope> {
  if (definition.scopes === '*') {
    return new Set(ALL_SCOPES);
  }
  const scopes = new Set<TokenScope>();
  for (const scope of definition.scopes) {
    scopes.add(scope);
    if (scope === 'metastore:admin') {
      for (const extra of ALL_SCOPES) {
        scopes.add(extra);
      }
    }
  }
  if (scopes.size === 0) {
    return new Set(ALL_SCOPES);
  }
  return scopes;
}

function toNamespaces(definition: TokenDefinition): Set<string> | '*' {
  if (definition.namespaces === '*') {
    return '*';
  }
  const namespaces = new Set<string>();
  for (const ns of definition.namespaces) {
    namespaces.add(ns.toLowerCase());
  }
  if (namespaces.size === 0) {
    return '*';
  }
  return namespaces;
}

export function createIdentityFromToken(definition: TokenDefinition, token: string): AuthIdentity {
  return {
    subject: definition.subject,
    kind: definition.kind,
    scopes: toScopeSet(definition),
    namespaces: toNamespaces(definition),
    tokenHash: hashToken(token),
    authDisabled: false
  } satisfies AuthIdentity;
}

export function createDisabledIdentity(): AuthIdentity {
  return {
    subject: 'local-dev',
    kind: 'service',
    scopes: new Set(ALL_SCOPES),
    namespaces: '*',
    tokenHash: 'auth-disabled',
    authDisabled: true
  } satisfies AuthIdentity;
}

export function hasScope(identity: AuthIdentity, scope: TokenScope): boolean {
  return identity.scopes.has(scope) || identity.scopes.has('metastore:admin');
}

export function canAccessNamespace(identity: AuthIdentity, namespace: string): boolean {
  if (identity.namespaces === '*') {
    return true;
  }
  return identity.namespaces.has(namespace.toLowerCase());
}
