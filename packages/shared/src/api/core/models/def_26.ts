/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type def_26 = {
  /**
   * Identifier for the authenticated principal (user email, service name, or token subject).
   */
  subject: string;
  /**
   * Identity classification.
   */
  kind: 'user' | 'service';
  /**
   * Granted operator scopes.
   */
  scopes: Array<string>;
  userId?: string | null;
  sessionId?: string | null;
  apiKeyId?: string | null;
  /**
   * Indicates that the server is running with authentication disabled for local development.
   */
  authDisabled?: boolean;
  displayName?: string | null;
  email?: string | null;
  /**
   * Role slugs assigned to the identity.
   */
  roles?: Array<string>;
};

