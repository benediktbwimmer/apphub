# Ticket 602: Introduce Theme Provider and Runtime Switching UX

## Problem
Theme selection today is implicit—Tailwind toggles based on `prefers-color-scheme`, and runtime consumers listen only for `dark` classes. Users cannot opt into branded palettes or high-contrast modes, and state is not persisted between sessions or devices.

## Proposal
- Implement `ThemeProvider` in `apps/frontend/src/theme/` that applies `data-theme` and assists with dark/high-contrast flags, reading defaults from user preferences or tenant configuration.
- Extend existing `useIsDarkMode` and Monaco hooks to observe `data-theme` changes, exposing the resolved semantic theme ID to consumers.
- Add a lightweight settings surface where users select among available themes (default light/dark, brand variants, high-contrast) with persistence through backend profile APIs or local storage fallback.

## Deliverables
- Theme context/provider with hooks (`useTheme`, `useToken`) and local storage syncing.
- Updated bootstrap sequence wrapping `App` with the provider and emitting telemetry for theme switches.
- UX entry point (settings modal or dropdown) enabling end-user selection, plus documentation for tenant-level defaults.

## Risks & Mitigations
- **State divergence:** Define a single source of truth (provider) and migrate all legacy dark-mode checks to it during implementation.
- **Accessibility gaps:** Partner with design to validate color contrast on the new options before release.
