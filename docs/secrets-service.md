# Managed Secrets Service

The managed secrets service brokers short-lived credentials for workflows, jobs, and
extensions that need to access secret material without embedding raw values in the
core process. The service centralizes auditing, supports multiple secret backends,
and exposes a REST API for issuing, refreshing, and revoking scoped access tokens.

## Running the service

```
npm run dev --workspace @apphub/secrets
```

The service listens on `0.0.0.0:4010` by default. Override the host or port with
`SECRETS_SERVICE_HOST` / `SECRETS_SERVICE_PORT`.

### Required configuration

| Variable | Description |
| --- | --- |
| `SECRETS_SERVICE_ADMIN_TOKENS` | JSON array of admin token definitions (see below) |
| `SECRETS_SERVICE_ADMIN_TOKENS_PATH` | Optional path to a JSON file with the same shape |

Each admin token entry must provide:

```json
{
  "token": "<opaque bearer token>",
  "subject": "core.workflows",
  "allowedKeys": ["*"],
  "maxTtlSeconds": 3600,
  "metadata": { "owner": "platform-ops" }
}
```

`allowedKeys` accepts `"*"` for wildcard or a list of permitted keys. `maxTtlSeconds`
clamps requests so callers cannot mint excessively long-lived credentials.

### Backends

Backends are enabled via `SECRETS_SERVICE_BACKENDS`. The default is `env,file`.

- **Env backend (`env`)** — Parses JSON from `APPHUB_SECRET_STORE`. This is useful for
development and for inline fallback during migrations.
- **File backend (`file`)** — Reads JSON from `SECRETS_SERVICE_FILE_PATH` (falls back to
`APPHUB_SECRET_STORE_PATH`). Set `SECRETS_SERVICE_FILE_OPTIONAL=1` to ignore missing files.
- **Vault backend (`vault`)** — Loads JSON from `SECRETS_SERVICE_VAULT_FILE`. The loader is
file-backed today so operators can sync material from HashiCorp Vault (or similar)
brfore pointing the service at a managed mount. `SECRETS_SERVICE_VAULT_NAMESPACE` and
`SECRETS_SERVICE_VAULT_OPTIONAL` control namespace tagging and optional loads.

Backends can be combined; later backends overwrite earlier definitions for duplicate keys.

### Refresh and inline fallback

`SECRETS_SERVICE_REFRESH_INTERVAL_MS` triggers periodic reloads of every backend. The
`POST /v1/secrets/refresh` endpoint forces a refresh on demand. Setting
`SECRETS_SERVICE_INLINE_FALLBACK=1` keeps the legacy inline lookup available as a last
resort when managed backends do not supply a value.

## API surface

All admin endpoints require the configured bearer token in the `Authorization: Bearer`
header. Secret fetches require a scoped token issued by one of the admin endpoints.

| Method & path | Description |
| --- | --- |
| `POST /v1/tokens` | Issue a new scoped secret token. Body: `{ "subject": "...", "keys": ["SECRET_KEY"], "ttlSeconds": 300 }`. Returns the opaque token and expiry. |
| `POST /v1/tokens/:token/refresh` | Extend a token before it expires. Optional `ttlSeconds` overrides the default. |
| `DELETE /v1/tokens/:token` | Revoke a token immediately. |
| `GET /v1/secrets/:key` | Resolve a secret using a scoped token. Returns `{ key, value, version, metadata, backend, tokenExpiresAt }`. |
| `POST /v1/secrets/refresh` | Force all backends to reload. Useful after rotations. |
| `GET /v1/status` | Debug endpoint exposing the current registry snapshot and active tokens (metadata only). |
| `GET /healthz` / `GET /readyz` | Health probes. |

Secrets are cached in the service and in the shared client for a short time (`cacheTtlMs`),
so rotations usually take effect without restarts. Calling the refresh endpoint after
updating source material ensures the registry observes the latest values immediately.

## Audit events

Every token lifecycle change and secret access produces an event on the shared bus through
`@apphub/event-bus`:

- `secret.token.issued`
- `secret.token.refreshed`
- `secret.token.revoked`
- `secret.access`

The payloads include the token id/hash, subject, scopes, resolved backend, and outcome.
These events drive compliance reporting and can feed anomaly detectors.

## Client integration

Core services and workers now use the shared `SecretsClient` (see `@apphub/shared`) to
exchange admin credentials for scoped tokens automatically. Configure clients with:

| Variable | Description |
| --- | --- |
| `SECRETS_SERVICE_URL` | Base URL for the secrets service (defaults to `http://127.0.0.1:4010`). |
| `SECRETS_SERVICE_ADMIN_TOKEN` | Admin token used to mint scoped credentials. |
| `APPHUB_SECRETS_SUBJECT` | Optional subject override when the client issues tokens. |
| `APPHUB_SECRETS_TOKEN_TTL` | Requested TTL for short-lived tokens (seconds). |
| `APPHUB_SECRETS_CACHE_TTL_MS` | Local cache TTL for resolved values. |
| `APPHUB_SECRETS_MODE=inline` | Fallback to legacy inline secret resolution in emergencies. |

With `APPHUB_SECRETS_MODE=inline`, the core reuses the previous `APPHUB_SECRET_STORE`
behaviour. This provides a simple rollback mechanism while teams migrate their secret
material into the dedicated service.

## Rotation workflow

1. Update the appropriate backend (Vault, file, etc.) with the new secret value.
2. Call `POST /v1/secrets/refresh` or wait for the scheduled refresh interval.
3. Clients automatically pick up the new value within their cache TTL.
4. Revoke any outstanding scoped tokens if they should no longer access the updated key.

There is no need to restart core services to pick up rotations—the managed client refreshes
values lazily and invalidates cache entries when tokens expire.
