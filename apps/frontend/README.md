# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

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
