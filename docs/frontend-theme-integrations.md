# Frontend Theme Runtime Integrations

AppHub's runtime surfaces now pull their colours from the shared design token registry so that Monaco editors and the workflow graph stay aligned whenever a theme changes or tenants ship overrides.

## Monaco Editor

- `apps/frontend/src/theme/integrations/monacoTheme.ts` converts a `ThemeDefinition` into Monaco theme data (base, palette, selection, diff colours).
- `useMonacoTheme` exposes the active token-derived spec while `applyMonacoTheme` registers it with Monaco and switches the editor instance.
- `Editor` and `DiffViewer` retain their existing API; they just call `applyMonacoTheme` on mount and whenever the provider updates so custom themes flow through without manual registration code.

## Workflow Graph Canvas

- `createWorkflowGraphTheme` in `theme/integrations/workflowGraphTheme.ts` builds node/edge palettes from semantic tokens for every `WorkflowGraphCanvasNodeKind`.
- `WorkflowGraphCanvas` composes that base theme with caller overrides, ensuring tenant-specific colours simply override token values rather than patching component internals.
- The Vitest suite covers light, dark, and tenant high-contrast permutations to guard against regressions whenever tokens change.

## Utility Classes

- `index.css` now exposes semantic helpers such as `bg-surface-glass`, `border-subtle`, `text-accent`, `text-on-accent`, `text-scale-sm`, and `shadow-accent-soft`. These map directly to the shared token registry and replace ad-hoc Tailwind colour utilities.
- Status-driven helpers (`text-status-*`, `border-[color:var(--color-status-...)]`) keep toasts, form feedback, and JSON highlights aligned with semantic palettes.
- `getStatusToneClasses` centralises badge styling by mapping workflow/build statuses onto the new status token utilities, removing duplicated colour strings across feature modules.
- Typography helpers (`text-scale-*`, `font-weight-*`, `leading-scale-*`, `tracking-scale-*`) bind font sizing, weight, line height, and letter spacing to theme overrides.
- Catalog previews now rely on `catalog-preview-overlay`, `catalog-preview-pill`, and `catalog-preview-dot` utilities when rendering gallery cards or live tiles, while fullscreen takeovers reuse `catalog-fullscreen-backdrop`, `catalog-fullscreen-frame`, and `catalog-fullscreen-message` so gradients and overlays inherit tenant token palettes without custom dark-mode branches. Workflow builder overlays share the same approach via `workflow-dialog-backdrop`.
- The custom ESLint rule `semantic-tokens/no-raw-color-classnames` guards the components layer from regressing to raw Tailwind colours; use `[color:var(--token)]` escapes or the provided utilities when new combinations are required.

## Adding New Themes

- Register the new `ThemeDefinition` with `ThemeProvider` (tenant overrides, accessibility variants, etc.).
- Monaco and the workflow canvas will automatically consume the new tokens; no additional hard-coded palettes are required.
- Custom surfaces can re-use `createMonacoTheme` or `createWorkflowGraphTheme` for consistent semantics instead of duplicating colour maths.
