/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { def_27 } from '../models/def_27';
import type { def_74 } from '../models/def_74';
import type { def_75 } from '../models/def_75';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AuthService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Initiate OIDC login
   * Generates an OAuth authorization request and redirects the browser to the configured identity provider.
   * @returns void
   * @throws ApiError
   */
  public getAuthLogin({
    redirectTo,
  }: {
    /**
     * Optional relative path to redirect to after successful authentication.
     */
    redirectTo?: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/auth/login',
      query: {
        'redirectTo': redirectTo,
      },
      errors: {
        302: `Redirect to the external identity provider.`,
        400: `The request query parameters were invalid.`,
        500: `The identity provider request failed.`,
        503: `Single sign-on is not enabled on this instance.`,
      },
    });
  }
  /**
   * OIDC login callback
   * Handles the OAuth authorization response, issues a secure session cookie, and redirects back to the application.
   * @returns void
   * @throws ApiError
   */
  public getAuthCallback({
    state,
    code,
  }: {
    /**
     * Opaque login state value issued during the authorization request.
     */
    state: string,
    /**
     * Authorization code returned by the identity provider.
     */
    code: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/auth/callback',
      query: {
        'state': state,
        'code': code,
      },
      errors: {
        302: `User is redirected to the requested application page.`,
        400: `The login state or authorization payload was invalid.`,
        403: `The authenticated identity is not allowed to access the platform.`,
        500: `The identity provider request failed.`,
        503: `Single sign-on is not enabled on this instance.`,
      },
    });
  }
  /**
   * Terminate current session
   * Revokes the caller's active session and clears the session cookie.
   * @returns void
   * @throws ApiError
   */
  public postAuthLogout(): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/auth/logout',
    });
  }
  /**
   * Retrieve authenticated identity
   * Returns the subject, scopes, and metadata for the active session, API key, or operator token.
   * @returns def_27 Identity details.
   * @throws ApiError
   */
  public getAuthIdentity(): CancelablePromise<def_27> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/auth/identity',
      errors: {
        401: `No valid session or authorization token was provided.`,
        403: `The caller did not have permission to inspect identity information.`,
      },
    });
  }
  /**
   * List API keys
   * Returns the API keys owned by the authenticated user.
   * @returns def_74 API keys for the current user.
   * @throws ApiError
   */
  public getAuthApiKeys(): CancelablePromise<def_74> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/auth/api-keys',
      errors: {
        401: `No valid session or authorization token was provided.`,
        403: `The caller is not authorized to list API keys.`,
        503: `Authentication is disabled on this instance.`,
      },
    });
  }
  /**
   * Create API key
   * Mints a new API key scoped to the authenticated user.
   * @returns def_75 API key created successfully.
   * @throws ApiError
   */
  public postAuthApiKeys({
    requestBody,
  }: {
    requestBody?: ({
      name?: string;
      scopes?: Array<string>;
      expiresAt?: string;
    } | null),
  }): CancelablePromise<def_75> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/auth/api-keys',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `The API key request payload was invalid.`,
        401: `No valid session or authorization token was provided.`,
        403: `The caller is not authorized to create API keys.`,
        503: `Authentication is disabled on this instance.`,
      },
    });
  }
  /**
   * Revoke API key
   * Revokes an API key owned by the authenticated user.
   * @returns void
   * @throws ApiError
   */
  public deleteAuthApiKeys({
    id,
  }: {
    /**
     * Unique identifier of the API key to revoke.
     */
    id: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/auth/api-keys/{id}',
      path: {
        'id': id,
      },
      errors: {
        400: `The API key identifier was invalid.`,
        401: `No valid session or authorization token was provided.`,
        403: `The caller is not authorized to revoke API keys.`,
        404: `No API key matched the supplied identifier.`,
        503: `Authentication is disabled on this instance.`,
      },
    });
  }
}
