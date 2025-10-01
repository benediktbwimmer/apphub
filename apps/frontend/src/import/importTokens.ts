export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const DRAWER_SURFACE = 'bg-surface-glass shadow-elevation-xl backdrop-blur';

export const PANEL_SURFACE =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg transition-colors';
export const PANEL_SURFACE_SOFT =
  'rounded-3xl border border-subtle bg-surface-glass-soft p-6 shadow-elevation-md transition-colors';
export const CARD_CONDENSED =
  'flex items-center gap-3 rounded-2xl border border-subtle bg-surface-glass-soft p-3 text-scale-sm text-secondary shadow-elevation-sm';
export const CARD_SECTION =
  'flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass-soft p-4 transition-colors';

export const SECTION_LABEL = 'text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';
export const HEADING_PRIMARY = 'text-scale-lg font-weight-semibold text-primary';
export const HEADING_SECONDARY = 'text-scale-base font-weight-semibold text-primary';
export const SUBTEXT = 'text-scale-sm text-secondary';
export const BODY_TEXT = 'text-scale-sm text-secondary';
export const STATUS_MESSAGE = 'text-scale-sm text-secondary';
export const STATUS_META = 'text-scale-xs text-muted';

export const CARD_SURFACE =
  'flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass-soft p-4 transition-colors hover:border-accent hover:bg-surface-glass';
export const CARD_SURFACE_ACTIVE = 'ring-2 ring-accent';

export const TAG_BADGE =
  'inline-flex items-center rounded-full bg-surface-muted px-2.5 py-0.5 text-scale-2xs font-weight-semibold uppercase tracking-[0.25em] text-muted';

export const TAG_BADGE_STRONG =
  'inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-scale-2xs font-weight-semibold uppercase tracking-[0.25em] text-accent';

export const FILTER_BUTTON_BASE =
  `inline-flex w-full items-center justify-between rounded-full px-4 py-2 text-scale-sm font-weight-semibold transition-colors ${FOCUS_RING}`;
export const FILTER_BUTTON_ACTIVE = 'bg-accent text-on-accent shadow-elevation-md';
export const FILTER_BUTTON_INACTIVE = 'border border-subtle bg-surface-glass-soft text-secondary hover:border-accent hover:text-accent';

export const PRIMARY_BUTTON =
  `inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const SECONDARY_BUTTON =
  `inline-flex items-center gap-2 rounded-full border border-subtle px-3 py-1 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const SECONDARY_BUTTON_LARGE =
  `inline-flex items-center gap-2 rounded-full border border-subtle px-4 py-2 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;
export const DESTRUCTIVE_BUTTON =
  `inline-flex items-center gap-2 rounded-full border border-status-danger px-3 py-1 text-scale-sm font-weight-semibold text-status-danger transition-colors hover:bg-status-danger-soft disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

export const LINK_ACCENT =
  'inline-flex items-center gap-1 font-weight-semibold text-accent transition-colors hover:text-accent-strong';

export const INPUT =
  `rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${FOCUS_RING} disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted`;
export const TEXTAREA = `${INPUT} min-h-[120px] resize-y`;
export const FIELD_GROUP = 'flex flex-col gap-1 text-scale-sm text-secondary';
export const FIELD_LABEL = 'text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

export const FORM_HINT = 'flex flex-col gap-1 text-scale-xs text-muted';
export const FORM_HINT_DANGER = 'text-scale-xs text-status-danger';

export const STATUS_BADGE_NEUTRAL =
  'inline-flex items-center gap-2 rounded-full bg-surface-muted px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm';
export const STATUS_BADGE_ACCENT =
  'inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-scale-xs font-weight-semibold text-accent shadow-elevation-sm';
export const STATUS_BADGE_SUCCESS =
  'inline-flex items-center gap-2 rounded-full bg-status-success-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-success shadow-elevation-sm';
export const STATUS_BADGE_DANGER =
  'inline-flex items-center gap-2 rounded-full bg-status-danger-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-danger shadow-elevation-sm';
export const STATUS_BADGE_INFO =
  'inline-flex items-center gap-2 rounded-full bg-status-info-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-info shadow-elevation-sm';
export const STATUS_BADGE_WARNING =
  'inline-flex items-center gap-2 rounded-full bg-status-warning-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-warning shadow-elevation-sm';

export const ALERT_DANGER =
  'flex flex-col gap-2 rounded-2xl border border-status-danger bg-status-danger-soft p-3 text-scale-sm text-status-danger shadow-elevation-sm';
export const ALERT_INFO =
  'flex flex-col gap-2 rounded-2xl border border-status-info bg-status-info-soft p-3 text-scale-sm text-status-info shadow-elevation-sm';
export const ALERT_WARNING =
  'flex flex-col gap-2 rounded-2xl border border-status-warning bg-status-warning-soft p-3 text-scale-sm text-status-warning shadow-elevation-sm';

export const STEP_CARD_BASE =
  `flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${FOCUS_RING}`;
export const STEP_CARD_ACTIVE = 'border-accent bg-accent-soft text-accent';
export const STEP_CARD_COMPLETE = 'border-status-success bg-status-success-soft text-status-success';
export const STEP_CARD_PENDING = 'border-subtle bg-surface-glass-soft text-secondary hover:border-accent';

export const COUNTER_BADGE =
  'inline-flex flex-wrap items-center gap-2 rounded-full border border-subtle bg-surface-glass-soft px-3 py-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.25em] text-muted shadow-elevation-sm';
export const COUNTER_VALUE_BADGE =
  'inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-scale-2xs font-weight-semibold text-secondary';

export const SEGMENTED_BUTTON_BASE =
  `inline-flex flex-1 items-center justify-center rounded-full px-4 py-2 text-scale-sm font-weight-semibold transition-colors ${FOCUS_RING}`;
export const SEGMENTED_BUTTON_ACTIVE = 'bg-accent text-on-accent shadow-elevation-md';
export const SEGMENTED_BUTTON_INACTIVE = 'border border-subtle bg-surface-glass-soft text-secondary hover:border-accent hover:text-accent';

export const POSITIVE_SURFACE =
  'flex flex-col gap-4 rounded-2xl border border-status-success bg-status-success-soft p-4 text-scale-sm text-status-success shadow-elevation-sm';
