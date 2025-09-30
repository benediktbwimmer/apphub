# Ticket 601: Wire Tailwind and CSS Variable Pipeline To Tokens

## Problem
The frontend relies on Tailwind utilities generated at build time with hex literals baked into component markup. Without a bridge between tokens and utilities we cannot flip themes at runtime or ensure semantic colors flow across surfaces.

## Proposal
- Create a small build step (Vite plugin or script) that emits `:root[data-theme="*"]` CSS custom properties from the shared token package.
- Update `apps/frontend/src/index.css` to consume the generated variables via Tailwind `@theme` so utility classes reference `var(--token)` values instead of static colors.
- Provide fallbacks for legacy classes and document the migration strategy for contributors still using raw Tailwind color names.

## Deliverables
- Automated pipeline producing CSS custom properties for every registered theme during `dev` and `build`.
- Updated Tailwind configuration and global styles referencing semantic variables, with smoke tests proving light/dark parity.
- Migration note outlining how to convert existing utilities to semantic helpers.

## Risks & Mitigations
- **Build complexity:** Keep the generator standalone with watch-mode reloading; add Vitest coverage for emitted CSS snapshots.
- **Visual regressions:** Capture before/after Percy or Storybook screenshots for critical layouts prior to merge.
