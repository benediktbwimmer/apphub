# AppHub Design Tokens

The `@apphub/shared/designTokens` entrypoint centralises the colors, typography, spacing, and derived theme definitions used across web and service surfaces. Tokens are authored in TypeScript so downstream packages get static typing, autocomplete, and safe refactors.

## Token Groups
- **Foundation:** raw primitives (`palette`, `typography`, `spacing`, `radius`, `shadow`) that rarely change. These map to Tailwind ramps and layout scales.
- **Semantic:** named intents that product teams consume (`surface.canvas`, `text.muted`, `status.success`). Semantic values are derived from the foundation and may vary per theme.
- **Themes:** frozen `ThemeDefinition` objects describing a complete experience. The defaults are `apphub-light` and `apphub-dark` and can be extended through `createTheme`.

## Naming Guidelines
- Prefer intent over implementation: `surface.canvas` beats `background.primary`. Consumers should understand *where* to use a token, not *which color* it is.
- Keep names composable. Use dot notation that groups similar concepts (`text.secondary`, `text.inverse`). Avoid abbreviations unless already industry standard.
- When introducing new status colors, provide both the base tone and the on-tone contrast (`status.info` + `status.infoOn`).
- Gradients or multi-stop backgrounds belong in component code. Tokens should remain single CSS values.
- Document every new token in this file when you add it and include an accessibility note if the contrast ratio is close to 4.5:1.

## Creating Derived Themes
```ts
import { createTheme, defaultThemes } from '@apphub/shared/designTokens';

export const solarized = createTheme({
  base: defaultThemes.light,
  id: 'solarized-light',
  label: 'Solarized Light',
  overrides: {
    semantics: {
      surface: {
        canvas: '#fdf6e3',
        accent: '#eee8d5'
      },
      text: {
        primary: '#073642',
        accent: '#268bd2'
      }
    }
  }
});
```

`createTheme` deep merges the overrides without mutating the base and returns an immutable object, making it safe to reuse during server boot or in build pipelines.

## Contribution Checklist
1. Update or add unit tests under `packages/shared/tests/designTokens` that assert the new tokens.
2. Run `npm run build --workspace @apphub/shared` to regenerate the type declarations.
3. Sync with design before merging changes that alter existing semantic values.
