export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const DIALOG_SURFACE = 'w-full max-w-xl rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg';

export const HEADER_TITLE = 'text-scale-lg font-weight-semibold text-primary';
export const HEADER_SUBTITLE = 'mt-1 text-scale-sm text-secondary';

export const SECONDARY_BUTTON =
  `rounded-full border border-subtle px-4 py-2 text-scale-sm font-weight-semibold text-secondary transition-colors hover:bg-surface-glass-soft ${FOCUS_RING}`;
export const SECONDARY_BUTTON_COMPACT =
  `rounded-full border border-subtle px-3 py-1 text-scale-sm font-weight-semibold text-secondary transition-colors hover:bg-surface-glass-soft ${FOCUS_RING}`;
export const PRIMARY_BUTTON =
  `rounded-full bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const PRIMARY_BUTTON_DANGER =
  `rounded-full bg-status-danger px-4 py-2 text-scale-sm font-weight-semibold text-status-danger-on shadow-elevation-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING} focus-visible:outline-status-danger`;

export const INPUT_LABEL = 'flex flex-col gap-1 text-scale-sm text-secondary';
export const INPUT_LABEL_CAPTION = 'text-scale-xs font-weight-semibold uppercase tracking-wide text-muted';
export const TEXT_INPUT =
  `rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted`;
export const TEXTAREA_INPUT =
  `rounded-lg border border-subtle bg-surface-glass px-3 py-2 font-mono text-scale-xs text-primary shadow-sm transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted`;
export const TEXT_INPUT_DANGER = `${TEXT_INPUT} border-status-danger focus-visible:outline-status-danger`;
export const ERROR_TEXT = 'text-scale-xs text-status-danger';
export const CHECKBOX_INPUT =
  `h-4 w-4 rounded border border-subtle bg-surface-glass text-accent transition-colors ${FOCUS_RING} disabled:cursor-not-allowed`;
export const SELECT_INPUT =
  `rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted`;
export const CODE_SURFACE = 'block rounded-lg border border-subtle bg-surface-glass-soft px-3 py-2 font-mono text-scale-xs text-secondary';
export const CODE_SURFACE_DANGER =
  'mx-1 inline-flex items-center gap-1 rounded bg-status-danger-soft px-1.5 py-0.5 font-mono text-scale-xs text-status-danger';
export const DIALOG_SURFACE_DANGER =
  'w-full max-w-lg rounded-3xl border border-status-danger bg-surface-glass p-6 shadow-elevation-lg';
export const HEADER_TITLE_DANGER = 'text-scale-lg font-weight-semibold text-status-danger';
export const ALERT_SURFACE_DANGER =
  'space-y-2 rounded-2xl border border-status-danger bg-status-danger-soft p-4 text-scale-sm text-status-danger';
