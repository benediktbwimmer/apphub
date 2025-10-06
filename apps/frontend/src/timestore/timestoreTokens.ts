export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const PANEL_SURFACE =
  'rounded-2xl border border-subtle bg-surface-glass-soft p-4 shadow-elevation-sm transition-colors';
export const PANEL_SURFACE_LARGE =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg transition-colors backdrop-blur-md';
export const PANEL_SHADOW_ELEVATED = 'shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)]';

export const CARD_SURFACE =
  'rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-sm transition-colors';
export const CARD_SURFACE_SOFT =
  'rounded-2xl border border-subtle bg-surface-glass-soft p-4 shadow-elevation-sm transition-colors';
export const SCROLL_CONTAINER_SOFT =
  'max-h-[420px] overflow-auto rounded-2xl border border-subtle bg-surface-glass-soft p-4';

export const FIELD_GROUP = 'flex flex-col gap-1 text-scale-sm text-secondary';
export const FIELD_LABEL =
  'text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

export const INPUT =
  `rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted`;
export const TEXTAREA =
  `w-full rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted`;

export const PRIMARY_BUTTON =
  `rounded-full bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const PRIMARY_BUTTON_COMPACT =
  `rounded-full bg-accent px-4 py-2 text-scale-xs font-weight-semibold text-on-accent shadow-elevation-sm transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const SECONDARY_BUTTON =
  `rounded-full border border-subtle px-4 py-2 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const SECONDARY_BUTTON_COMPACT =
  `rounded-full border border-subtle px-3 py-1 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const OUTLINE_ACCENT_BUTTON =
  `rounded-full border border-accent px-4 py-2 text-scale-xs font-weight-semibold text-accent transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const DANGER_BUTTON =
  `rounded-full bg-status-danger px-4 py-2 text-scale-sm font-weight-semibold text-status-danger-on shadow-elevation-md transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const DANGER_SECONDARY_BUTTON =
  `rounded-full border border-status-danger px-4 py-2 text-scale-sm font-weight-semibold text-status-danger transition-colors hover:bg-status-danger-soft disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const SUCCESS_BUTTON =
  `rounded-full bg-status-success px-4 py-2 text-scale-sm font-weight-semibold text-status-success-on shadow-elevation-md transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

export const STATUS_BANNER_DANGER =
  'rounded-2xl border border-status-danger bg-status-danger-soft px-4 py-3 text-scale-sm text-status-danger';
export const STATUS_MESSAGE = 'text-scale-sm text-secondary';
export const STATUS_BANNER_WARNING =
  'rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-sm text-status-warning';
export const STATUS_BANNER_INFO =
  'rounded-2xl border border-status-info bg-status-info-soft px-4 py-3 text-scale-sm text-status-info';
export const STATUS_META = 'text-scale-xs text-muted';
export const KBD_BADGE =
  'inline-flex items-center rounded-md bg-surface-muted px-2 py-0.5 font-mono text-scale-2xs text-secondary shadow-elevation-sm';

export const DIALOG_SURFACE_DANGER =
  'w-full max-w-lg rounded-3xl border border-status-danger bg-surface-glass p-6 shadow-elevation-xl';
export const DIALOG_SURFACE =
  'w-full max-w-3xl rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl';

export const CHECKBOX_INPUT =
  `h-4 w-4 rounded border border-subtle bg-surface-glass text-accent transition-colors ${FOCUS_RING}`;

export const BADGE_PILL =
  'inline-flex items-center rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-semibold text-secondary';
export const BADGE_PILL_ACCENT =
  'inline-flex items-center rounded-full border border-accent px-3 py-1 text-scale-xs font-weight-semibold text-accent';
export const BADGE_PILL_MUTED =
  'inline-flex items-center rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-semibold text-muted';
export const BADGE_PILL_SUCCESS =
  'inline-flex items-center rounded-full bg-status-success-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-success shadow-elevation-sm';
export const BADGE_PILL_INFO =
  'inline-flex items-center rounded-full bg-status-info-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-info shadow-elevation-sm';
export const BADGE_PILL_WARNING =
  'inline-flex items-center rounded-full bg-status-warning-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-warning shadow-elevation-sm';
export const BADGE_PILL_DANGER =
  'inline-flex items-center rounded-full bg-status-danger-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-danger shadow-elevation-sm';
export const BADGE_PILL_NEUTRAL =
  'inline-flex items-center rounded-full bg-surface-muted px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm';

export const SEGMENTED_GROUP = 'flex gap-2 rounded-full border border-subtle bg-surface-glass-soft p-1';
export const SEGMENTED_BUTTON_BASE =
  `rounded-full px-3 py-1 text-scale-xs font-weight-semibold transition-colors ${FOCUS_RING}`;
export const SEGMENTED_BUTTON_ACTIVE = 'bg-accent text-on-accent shadow-elevation-sm';
export const SEGMENTED_BUTTON_INACTIVE =
  'border border-subtle text-secondary hover:border-accent hover:text-accent';

export const TABLE_CONTAINER =
  'rounded-2xl border border-subtle bg-surface-glass-soft';
export const TABLE_HEAD_ROW =
  'bg-surface-muted text-scale-2xs font-weight-semibold uppercase tracking-[0.2em] text-muted';
export const TABLE_CELL = 'px-4 py-2 text-scale-sm text-secondary';
export const TABLE_CELL_PRIMARY = 'px-4 py-2 text-scale-sm text-primary';
