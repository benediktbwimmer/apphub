# React + TypeScript + Vite

## Theming pipeline

- Runtime design tokens now live in `@apphub/shared/designTokens`; the Vite build emits CSS custom properties for every registered theme through the `virtual:apphub-theme.css` module.
- Global styles import the generated variables before Tailwind so utility classes such as `bg-surface-canvas` resolve to semantic tokens while legacy palette classes continue to function.
- During migration you can keep existing `text-slate-*` or `bg-violet-*` utilities; they fall back to their Tailwind defaults but we expose matching semantic helpers—prefer `text-[var(--color-text-muted)]` or `bg-surface-raised` for new work.
- When editing tokens run `npm run build --workspace @apphub/shared` to refresh the package `dist` output; the Vite dev server hot-reloads the generated CSS once the build completes.
- For bespoke gradients or imagery, set component-level variables (for example `--surface-canvas-background-image`) and reference the semantic colors for the base fills so tenant overrides stay in sync.

## Workflow topology data layer

The workflows surface now exposes a dedicated client and store for the topology graph. The `fetchWorkflowTopologyGraph` API reads the catalog payload and `normalizeWorkflowGraph` builds derived lookup maps (per-workflow indexes, asset/trigger adjacency, cache metadata) for downstream consumption. React code can access the data by wrapping pages in `WorkflowGraphProvider` and calling `useWorkflowGraph()`, which exposes loading/error state, the normalized graph, cache meta, and helper methods for manual refreshes.

The provider automatically listens for `workflow.run.*` and `workflow.definition.updated` websocket events, queuing them for later visualization work while triggering a debounced background refresh after definitions change. Tests for the store live in `src/workflows/hooks/__tests__/useWorkflowGraph.test.tsx`, and Storybook-friendly mocks are available in `src/workflows/graph/mocks.ts` for building UI scenarios.

## Shared API client

`src/lib/apiClient.ts` exposes a small wrapper around our authorized fetch that normalizes error handling and JSON parsing and optionally validates responses with `zod`. Jobs and workflows APIs now call the client instead of reimplementing `fetch`/`ensureOk`/`parseJson` loops. To add the client to other feature areas:

```ts
import { createApiClient, type AuthorizedFetch } from '../lib/apiClient';
import { API_BASE_URL } from '../config';
import { z } from 'zod';

const exampleSchema = z.object({ data: z.object({ value: z.string() }) });

export async function fetchExample(fetcher: AuthorizedFetch) {
  const client = createApiClient(fetcher, { baseUrl: API_BASE_URL });
  return client.get('/examples/endpoint', {
    schema: exampleSchema.transform(({ data }) => data.value),
    errorMessage: 'Failed to load example payload'
  });
}
```

The client automatically applies auth headers, attempts to decode JSON once, and throws a shared `ApiError` with parsed error bodies when the response is not OK. Pairing a schema with a `.transform()` lets feature code collapse `payload.data` guards and return domain types directly.

## Environment variables

Set the following variables in `.env.local` to target locally running services:

- `VITE_API_BASE_URL` – Catalog API base URL (defaults to `http://localhost:4000`).
- `VITE_TIMESTORE_BASE_URL` – Timestore API base URL (defaults to `${VITE_API_BASE_URL}/timestore`).
- `VITE_METASTORE_BASE_URL` – Metastore API base URL (defaults to `${VITE_API_BASE_URL}/metastore`).
- `VITE_FILESTORE_BASE_URL` – Filestore API base URL (defaults to `${VITE_API_BASE_URL}/filestore`).

## Filestore explorer

- The services console now includes a Filestore explorer at `/services/filestore`. Supply an operator token with the `filestore:read` scope (and `filestore:write` for reconciliation controls) via the auth dropdown in the UI.
- Point the explorer at a running Filestore instance by setting `VITE_FILESTORE_BASE_URL` in `.env.local` (defaults to `${VITE_API_BASE_URL}/filestore`).
- The page consumes the typed helpers in `apps/frontend/src/filestore/api.ts` for listings, node detail polling, metadata updates, uploads, move/copy operations, and SSE activity feeds.
- A write tab exposes upload, move, copy, and delete actions when the authenticated identity has `filestore:write`; these interactions surface `filestore.node.uploaded`, `filestore.node.moved`, and `filestore.node.copied` events in the activity feed.
- Live SSE subscriptions are scoped by the selected mount, any active path filter, and the activity feed category toggles to avoid unnecessary refreshes; polling intervals back off automatically once a scoped stream is active.
- The activity feed exposes category pills (node changes, commands, drift, reconciliation, downloads) so operators can enable or silence specific event types without leaving the page.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
