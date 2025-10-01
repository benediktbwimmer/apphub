# Authentication & Authorization Strategy

## Objectives
- Provide a first-class interactive login experience so operators can authenticate with managed identities (starting with Google, easily extensible to other OpenID Connect providers).
- Replace static operator tokens with user-scoped permissions while preserving fine-grained scopes for workflow and job actions.
- Allow authenticated users to mint and revoke API keys for automation or CLI usage without exposing their personal OAuth tokens.
- Centralize auditing of logins, session refreshes, and API key usage.
- Avoid blocking existing worker integrations during rollout by supporting both the legacy token model and the new system in parallel.

## Personas & Access Modes
- **Interactive operators**: log into the web UI, manage workflows/jobs, inspect builds. Require browser-based SSO, session persistence, and scoped authorizations.
- **Automation/CLI clients**: call the core API programmatically. Need long-lived API keys with optional scope constraints and rotation support.
- **Background services**: ingestion/build workers and any external services acting on behalf of the platform. Continue to authenticate with managed service principals that can be migrated to the new API-key flow.

## Proposed Architecture

### Identity Provider Integration
- Use OpenID Connect compliant OAuth2 flows via `openid-client` (preferred) or `@fastify/oauth2` with PKCE. Initial provider: Google Workspace / Google Cloud Identity.
- Configure provider metadata via `APPHUB_OIDC_ISSUER`, `APPHUB_OIDC_CLIENT_ID`, `APPHUB_OIDC_CLIENT_SECRET`, and `APPHUB_OIDC_ALLOWED_DOMAINS` (comma-separated) to restrict who can log in.
- During login, request `openid email profile` scopes. Persist the stable `sub` claim as the primary external identifier, with email + profile data for display only.

### Backend Components (Fastify / services/core)
- **/auth/login**: initiates the PKCE authorization request, sets a short-lived nonce in an encrypted cookie.
- **/auth/callback**: exchanges the authorization code for tokens, validates `state` + `nonce`, retrieves the user profile, and creates (or reuses) a local user record.
- **Session service**: issues HTTP-only, Secure, SameSite-strict cookies containing a signed session identifier. Store session data server-side (recommended):
  - Table `sessions`: `id`, `user_id`, `expires_at`, `ip`, `user_agent`, `refresh_token_hash` (optional if using refresh tokens), `created_at`, `updated_at`.
  - Refresh tokens (if used) are hashed and stored; otherwise, session rotation happens on a sliding window.
- **User service**: maintains:
  - `users`: `id`, `primary_email`, `display_name`, `avatar_url`, `created_at`, `last_login_at`, `status` (`active`, `suspended`).
  - `user_identities`: `id`, `user_id`, `provider`, `provider_subject`, `email`, `created_at`, `last_seen_at` to permit future multi-provider logins.
- **API key service**: new tables:
  - `api_keys`: `id`, `user_id`, `name`, `prefix`, `token_hash`, `scopes`, `last_used_at`, `expires_at`, `created_at`, `revoked_at`, `metadata` (JSON for notes), `created_by_session_id`.
  - `api_key_events`: audit trail for creation, rotation, revocation.
  - Tokens are generated as `<prefix>.<random>` (e.g., `apphub_live_abc123...`) where only the hash is stored.
- **Local development bypass**: when `APPHUB_AUTH_DISABLED=true`, the service returns a synthetic operator identity with full scopes so developers can work offline without provisioning tokens. This mode should never be enabled in shared or production environments.
- **Authorization middleware**: unify session and API key handling in a single guard:
  - Attempt cookie session validation first; if present, attach `request.operatorIdentity` with scopes resolved from the user’s role membership.
  - Fallback to API key lookup (bearer token) for machine clients.
  - Maintain legacy operator tokens during migration behind a feature flag (`APPHUB_LEGACY_OPERATOR_TOKENS=true`).

### Frontend (apps/frontend)
- Replace the local API token context with a session-aware auth store:
  - On load, call `GET /auth/identity` which now relies on the session cookie.
  - Add a sign-in page that redirects to `/auth/login` and handles `onboarding` flows for first-time users (optional).
  - Provide UI for listing, creating, and revoking API keys. Surfaced under user settings with scope selection and usage logs.
  - Update `useAuthorizedFetch` to rely on cookies for interactive users and optionally insert API key headers when the user selects a specific key for CLI copy.
- Ensure CSRF protection for state-changing requests (`@fastify/csrf-protection` or a custom double-submit cookie with session binding).

### Authorization Model
- Retain scope semantics (`jobs:write`, `workflows:run`, etc.) but map them through roles:
  - `roles`: `id`, `slug`, `description`.
  - `role_scopes`: mapping table between roles and operator scopes.
  - `user_roles`: assign roles to users.
- Default roles:
  - `viewer`: `jobs:run`, `workflows:run`, `job-bundles:read`.
  - `editor`: inherits viewer scopes + `jobs:write`, `workflows:write`.
  - `admin`: wildcard `*` scopes + API key management rights.
- API keys inherit the scopes of their issuing user by default but can be constrained to a subset during creation.

## Authentication Flows

### Interactive Login (Browser)
1. User selects "Continue with Google"; frontend calls `/auth/login` which returns the provider redirect URL + PKCE verifier.
2. Browser is redirected to Google OAuth consent; after approval, Google redirects back to `/auth/callback` with `code` + `state`.
3. Callback endpoint exchanges the code, validates ID token claims (`email_verified`, domain allowlist), and loads/creates the local user.
4. Session is created, session cookie set, and user redirected to the dashboard. Session TTL defaults to 12 hours of inactivity (configurable) with automatic renewal up to 30 days.
5. Frontend fetches `/auth/identity` to populate user context and scopes.

### Session Refresh & Logout
- Idle timeout enforced via `expires_at`; refresh the session on active requests near expiry.
- Provide `/auth/logout` to clear cookies server-side and revoke the active session record.
- Background job sweeps expired sessions nightly and logs inactivity via audit tables.

### API Key Lifecycle
1. Authenticated users visit the API keys settings page.
2. Frontend POSTs to `/auth/api-keys` with `name`, optional `scopes`, and TTL. Backend ensures requested scopes ⊆ user scopes.
3. Backend generates token: `prefix = base32(user_id + timestamp)` stored in cleartext for display; `secret = 32 byte random`. Only the composite token is shown once.
4. Token is returned one time; the hash is persisted along with metadata.
5. Requests using `Authorization: Bearer <token>` resolve to the associated user identity and scopes.
6. Users can revoke keys via `DELETE /auth/api-keys/:id`; backend flags `revoked_at`, records audit log, and drops from cache.
7. `last_used_at` updates asynchronously (buffered queue) to avoid synchronous writes on every request.

### Machine Clients & Workers
- Workers migrate to API keys created under a dedicated service account user (`kind = service`).
- Support non-interactive key creation via admin-only CLI command or `POST /auth/api-keys` with `kind=service` when bootstrapping infrastructure.
- Provide a read-only public key endpoint to allow verifying token prefix ownership without revealing secrets (for support tooling).

## Auditing & Observability
- Extend `audit_logs` to include `category` (`auth.login`, `auth.logout`, `auth.api_key.create`, etc.) and structured metadata (provider, IP, user agent).
- Emit metrics: active sessions, login success/failure counts, API key usage (requests/min by key prefix), suspicious activity alerts (multiple failures).
- Integrate with existing alerting by triggering alerts on repeated auth failures from the same IP or rapid key creation bursts.

## Migration Plan
1. **Scaffolding (Sprint 1)**
   - Land database migrations for `users`, `user_identities`, `sessions`, `api_keys`, `roles` and mapping tables.
   - Implement user + session models and admin CLI to bootstrap the first admin user (using existing operator token).
2. **OAuth Sign-In (Sprint 2)**
   - Integrate Google OIDC, implement `/auth/login` + `/auth/callback`, and basic session cookies.
   - Add `/auth/identity` response changes and update frontend to rely on session-based auth.
   - Gate behind feature flag `APPHUB_AUTH_SSO_ENABLED`.
3. **API Key Management (Sprint 3)**
   - Build API endpoints for key CRUD and UI management.
   - Issue keys for existing automation clients and update workers to use them.
4. **Sunset Legacy Tokens (Sprint 4)**
   - Add telemetry + warnings when legacy tokens are used.
   - After migration, disable `APPHUB_LEGACY_OPERATOR_TOKENS`, remove fallback path, and clean up unused secrets.
5. **Hardening & Compliance (Ongoing)**
   - Implement CSRF protection, brute-force throttling on login endpoints, and session anomaly detection.
   - Add support for additional providers (GitHub, Azure AD) as needed via extra entries in `user_identities`.

## Open Questions & Follow-Ups
- Clarify requirement for multi-tenancy or organization scoping (per-domain restrictions vs. invite-based onboarding).
- Determine whether API keys need IP restrictions or environment scoping (dev/prod separation).
- Decide on secret storage solution for client secrets (Vault vs. environment variables).
- Align with legal/compliance for session retention policies and audit log storage duration.

## Impact Summary
- **services/core**: new auth routes, session middleware, DB models, and updated `requireOperatorScopes` to support session-derived identities.
- **apps/frontend**: replace token selector UI with user account dropdown, implement SSO redirect flows, and add API key management screens.
- **docs**: update `docs/architecture.md` security section to reference this strategy.
- **Operations**: configure Google OAuth credentials, rotate signing keys, and document runbooks for login issues and key revocation.
