export const DATA_ASSET_FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const DATA_ASSET_PAGE_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-6 text-scale-sm text-secondary shadow-elevation-lg backdrop-blur-md transition-colors';

export const DATA_ASSET_HEADER_LABEL =
  'text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-accent-strong';
export const DATA_ASSET_HEADER_TITLE = 'text-scale-lg font-weight-semibold text-primary';
export const DATA_ASSET_HEADER_SUBTITLE = 'text-scale-xs text-muted';

export const DATA_ASSET_ALERT_ERROR =
  'rounded-2xl border border-status-danger bg-status-danger-soft px-4 py-3 text-scale-sm text-status-danger shadow-elevation-sm';
export const DATA_ASSET_ALERT_INFO =
  'rounded-2xl border border-status-info bg-status-info-soft px-4 py-3 text-scale-sm text-status-info shadow-elevation-sm';
export const DATA_ASSET_ALERT_WARNING =
  'rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-sm text-status-warning shadow-elevation-sm';

export const DATA_ASSET_STATUS_BADGE_FRESH =
  'inline-flex items-center gap-2 rounded-full bg-status-success-soft px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em] text-status-success shadow-elevation-sm';
export const DATA_ASSET_STATUS_BADGE_STALE =
  'inline-flex items-center gap-2 rounded-full bg-status-warning-soft px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em] text-status-warning shadow-elevation-sm';
export const DATA_ASSET_STATUS_BADGE_REFRESH =
  'inline-flex items-center gap-2 rounded-full bg-status-info-soft px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em] text-status-info shadow-elevation-sm';

export const DATA_ASSET_CARD =
  'rounded-2xl border border-subtle bg-surface-glass-soft p-4 text-scale-sm text-secondary shadow-elevation-sm';
export const DATA_ASSET_TABLE_CONTAINER =
  'overflow-hidden rounded-2xl border border-subtle bg-surface-glass-soft';
export const DATA_ASSET_TABLE_HEADER =
  'px-4 py-3 text-left text-scale-xs font-weight-semibold uppercase tracking-wide text-muted';
export const DATA_ASSET_TABLE_CELL = 'px-4 py-3 text-scale-sm text-secondary align-top';
export const DATA_ASSET_TABLE_ROW_HIGHLIGHT = 'bg-status-warning-soft/70';

export const DATA_ASSET_BADGE_MUTED =
  'inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-scale-2xs font-weight-semibold text-secondary';

export const DATA_ASSET_EMPTY_STATE =
  'flex h-[520px] items-center justify-center rounded-3xl border border-subtle bg-surface-glass-soft text-scale-sm text-secondary shadow-elevation-sm backdrop-blur-md';

export const DATA_ASSET_DETAIL_PANEL =
  'flex h-[520px] flex-col gap-4 overflow-hidden rounded-3xl border border-subtle bg-surface-glass-soft p-5 text-scale-sm text-secondary shadow-elevation-lg backdrop-blur-md transition-colors';
export const DATA_ASSET_DETAIL_TITLE = 'text-scale-base font-weight-semibold text-primary';
export const DATA_ASSET_DETAIL_SUBTITLE =
  'text-scale-2xs font-weight-medium uppercase tracking-[0.28em] text-muted';
export const DATA_ASSET_SECTION_TITLE =
  'text-scale-2xs font-weight-semibold uppercase tracking-[0.28em] text-muted';
export const DATA_ASSET_SECTION_TEXT = 'text-scale-sm text-secondary';

export const DATA_ASSET_SELECT_LABEL =
  'flex flex-col gap-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.28em] text-muted';
export const DATA_ASSET_SELECT =
  `rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm font-weight-medium text-primary shadow-sm transition-colors ${DATA_ASSET_FOCUS_RING}`;

export const DATA_ASSET_PARTITION_META = 'text-scale-xs text-muted';
export const DATA_ASSET_PARTITION_TABLE_TEXT = 'text-scale-sm text-secondary';

const ACTION_PILL_BASE =
  `inline-flex items-center gap-2 rounded-full border px-3 py-1 text-scale-2xs font-weight-semibold uppercase tracking-[0.3em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_ACTION_PILL_WARNING =
  `${ACTION_PILL_BASE} border-status-warning bg-status-warning-soft text-status-warning hover:bg-status-warning-soft/80`;
export const DATA_ASSET_ACTION_PILL_SUCCESS =
  `${ACTION_PILL_BASE} border-status-success bg-status-success-soft text-status-success hover:bg-status-success-soft/80`;
export const DATA_ASSET_ACTION_PILL_ACCENT =
  `${ACTION_PILL_BASE} border-accent bg-accent px-4 text-on-accent shadow-elevation-sm hover:bg-accent-strong`;

export const DATA_ASSET_DIALOG_SURFACE =
  'flex max-w-2xl flex-col overflow-hidden rounded-3xl border border-subtle bg-surface-glass shadow-elevation-xl backdrop-blur-md';
export const DATA_ASSET_DIALOG_HEADER =
  'flex items-start justify-between gap-4 border-b border-subtle bg-surface-glass-soft px-6 py-4';
export const DATA_ASSET_DIALOG_TITLE = 'text-scale-lg font-weight-semibold text-primary';
export const DATA_ASSET_DIALOG_META = 'text-scale-xs text-muted';
export const DATA_ASSET_DIALOG_CLOSE_BUTTON =
  `rounded-full border border-subtle px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft/70 hover:text-accent-strong ${DATA_ASSET_FOCUS_RING}`;

export const DATA_ASSET_SEGMENTED_GROUP = 'flex flex-wrap gap-2';
export const DATA_ASSET_SEGMENTED_BUTTON =
  `rounded-full border px-4 py-2 text-scale-xs font-weight-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_SEGMENTED_BUTTON_ACTIVE = 'border-accent bg-accent text-on-accent shadow-elevation-sm';
export const DATA_ASSET_SEGMENTED_BUTTON_INACTIVE =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

export const DATA_ASSET_BUTTON_PRIMARY =
  `rounded-full bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_BUTTON_SECONDARY =
  `rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_BUTTON_TERTIARY =
  `rounded-full border border-transparent px-3 py-1.5 text-scale-xs font-weight-semibold text-secondary transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_BUTTON_GHOST =
  `text-scale-xs font-weight-semibold text-secondary transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_BUTTON_DANGER =
  `rounded-full bg-status-danger px-4 py-2 text-scale-sm font-weight-semibold text-status-danger-on shadow-elevation-md transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${DATA_ASSET_FOCUS_RING}`;

export const DATA_ASSET_FORM_FIELD = 'flex flex-col gap-1';
export const DATA_ASSET_FORM_LABEL = 'text-scale-sm font-weight-semibold text-primary';
export const DATA_ASSET_FORM_LABEL_COMPACT = 'text-scale-xs font-weight-semibold text-primary';
export const DATA_ASSET_FORM_HELPER = 'text-scale-xs text-muted';
export const DATA_ASSET_FORM_INPUT =
  `rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_FORM_ARRAY_NOTICE =
  'flex flex-col gap-1 rounded-2xl border border-status-warning bg-status-warning-soft px-3 py-3 text-scale-xs text-status-warning';
export const DATA_ASSET_FORM_UNSUPPORTED =
  'flex flex-col gap-1 rounded-2xl border border-subtle bg-surface-muted px-3 py-3 text-scale-xs text-muted';

export const DATA_ASSET_CHECKBOX = `h-4 w-4 rounded border border-subtle bg-surface-glass text-accent ${DATA_ASSET_FOCUS_RING}`;

export const DATA_ASSET_EDITOR =
  `rounded-2xl border border-subtle bg-surface-glass text-scale-sm text-primary shadow-sm transition-colors ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_EDITOR_ERROR = 'border-status-danger shadow-[0_0_0_1px_var(--color-status-danger)]';

export const DATA_ASSET_NOTE = 'text-scale-xs text-muted';

export const DATA_ASSET_GRAPH_CONTAINER =
  'h-[520px] rounded-3xl border border-subtle bg-surface-glass shadow-inner transition-colors';
export const DATA_ASSET_GRAPH_CONTROLS =
  `rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-xs text-secondary shadow-elevation-lg backdrop-blur-sm ${DATA_ASSET_FOCUS_RING}`;
export const DATA_ASSET_GRAPH_EMPTY_TEXT = 'text-scale-sm text-secondary';
export const DATA_ASSET_GRAPH_GRID_COLOR =
  'color-mix(in srgb, var(--color-accent-default) 22%, transparent)';
export const DATA_ASSET_GRAPH_EDGE = 'var(--color-border-strong)';
export const DATA_ASSET_GRAPH_EDGE_LABEL_BACKGROUND = 'var(--surface-glass-soft)';
export const DATA_ASSET_GRAPH_EDGE_LABEL_BORDER = 'var(--color-border-subtle)';
export const DATA_ASSET_GRAPH_EDGE_LABEL_TEXT = 'var(--color-text-muted)';

export const DATA_ASSET_GRAPH_NODE = {
  base: {
    border: '1px solid var(--color-border-subtle)',
    background: 'var(--surface-glass-strong)',
    shadow: 'var(--shadow-lg)'
  },
  refresh: {
    border: '2px solid var(--color-status-info)',
    background: 'color-mix(in srgb, var(--color-status-info) 18%, var(--surface-glass-soft))',
    shadow: '0 28px 48px -30px color-mix(in srgb, var(--color-status-info) 45%, transparent)'
  },
  stale: {
    border: '2px solid var(--color-status-warning)',
    background: 'color-mix(in srgb, var(--color-status-warning) 18%, var(--surface-glass-soft))',
    shadow: '0 28px 48px -30px color-mix(in srgb, var(--color-status-warning) 45%, transparent)'
  },
  selected: {
    border: '2px solid var(--color-accent-default)',
    shadow: 'var(--shadow-xl)'
  }
} as const;
