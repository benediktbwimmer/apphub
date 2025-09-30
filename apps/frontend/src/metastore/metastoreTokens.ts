export const METASTORE_SECTION_LABEL_CLASSES =
  'text-[11px] font-weight-semibold uppercase tracking-[0.3em] text-muted';

export const METASTORE_HELPER_ROW_CLASSES = 'flex items-center gap-3 text-scale-xs text-muted';

export const METASTORE_INPUT_COMPACT_CLASSES =
  'w-48 rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted disabled:opacity-60';

export const METASTORE_INLINE_BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_ERROR_TEXT_CLASSES = 'text-scale-xs text-status-danger';

export const METASTORE_DIALOG_CONTENT_CLASSES =
  'w-full max-w-4xl rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

export const METASTORE_DIALOG_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

export const METASTORE_DIALOG_SUBTITLE_CLASSES = 'text-scale-sm text-secondary';

export const METASTORE_CONTROL_TRIGGER_CLASSES =
  'flex w-48 items-center justify-between gap-3 rounded-full border border-subtle bg-surface-glass px-4 py-2 text-left text-scale-sm text-primary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_CONTROL_ICON_CLASSES = 'text-scale-xs text-muted';

export const METASTORE_WARNING_NOTE_CLASSES = 'text-scale-xs text-status-warning';

export const METASTORE_WARNING_LINK_CLASSES =
  'inline-flex items-center rounded-full border border-status-warning bg-status-warning-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-warning transition-colors hover:bg-status-warning-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-warning';

export const METASTORE_CARD_CONTAINER_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg transition-colors';

export const METASTORE_ALERT_WARNING_CLASSES =
  'rounded-3xl border border-status-warning bg-status-warning-soft px-4 py-3 text-scale-sm text-status-warning';

export const METASTORE_STATUS_TONE_CLASSES: Record<'success' | 'info' | 'warn' | 'error' | 'neutral', string> = {
  success: 'border-status-success bg-status-success-soft text-status-success',
  info: 'border-status-info bg-status-info-soft text-status-info',
  warn: 'border-status-warning bg-status-warning-soft text-status-warning',
  error: 'border-status-danger bg-status-danger-soft text-status-danger',
  neutral: 'border-subtle bg-surface-muted text-secondary'
};

export const METASTORE_STATUS_DOT_CLASSES: Record<'success' | 'info' | 'warn' | 'error' | 'neutral', string> = {
  success: 'bg-status-success',
  info: 'bg-status-info',
  warn: 'bg-status-warning',
  error: 'bg-status-danger',
  neutral: 'bg-muted'
};

export const METASTORE_DROPDOWN_PANEL_CLASSES =
  'absolute left-0 top-full z-50 mt-2 w-72 rounded-3xl border border-subtle bg-surface-glass shadow-elevation-xl backdrop-blur-md';

export const METASTORE_DROPDOWN_SEARCH_CLASSES = 'flex items-center gap-2 border-b border-subtle px-4 py-3';

export const METASTORE_DROPDOWN_SEARCH_INPUT_CLASSES =
  'w-full bg-transparent text-scale-sm text-primary placeholder:text-muted outline-none';

export const METASTORE_DROPDOWN_SECTION_HEADER_CLASSES =
  'px-3 text-[11px] font-weight-semibold uppercase tracking-[0.3em] text-muted';

export const METASTORE_DROPDOWN_EMPTY_TEXT_CLASSES = 'px-4 py-6 text-scale-sm text-secondary';

export const METASTORE_MANUAL_ENTRY_CONTAINER_CLASSES =
  'mt-2 border-t border-subtle pt-3 text-scale-sm text-secondary';

export const METASTORE_MANUAL_ENTRY_BUTTON_CLASSES =
  'flex w-full items-center justify-between rounded-2xl border border-dashed border-subtle px-4 py-2 text-left text-scale-sm text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const METASTORE_OPTION_BUTTON_BASE_CLASSES =
  'flex flex-1 flex-col gap-1 rounded-2xl border px-4 py-2 text-left text-scale-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const METASTORE_OPTION_BUTTON_AUTHORIZED_CLASSES =
  'border-transparent bg-surface-glass text-primary hover:border-accent-soft hover:bg-accent-soft';

export const METASTORE_OPTION_BUTTON_ACTIVE_CLASSES = 'border-accent bg-accent-soft text-accent-strong';

export const METASTORE_OPTION_BUTTON_DISABLED_CLASSES =
  'border border-status-warning bg-status-warning-soft text-status-warning cursor-not-allowed';

export const METASTORE_OPTION_BADGE_ACTIVE_CLASSES =
  'rounded-full bg-accent-soft px-2 py-[2px] text-[11px] font-weight-semibold uppercase tracking-wide text-accent';

export const METASTORE_OPTION_SECONDARY_TEXT_CLASSES = 'text-scale-xs text-muted';

export const METASTORE_OPTION_WARNING_TEXT_CLASSES = 'text-scale-xs text-status-warning';

export const METASTORE_FAVORITE_BUTTON_BASE_CLASSES =
  'mt-1 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent hover:text-accent';

export const METASTORE_FAVORITE_BUTTON_ACTIVE_CLASSES = 'text-status-warning hover:text-status-warning';

export const METASTORE_META_TEXT_CLASSES = 'text-scale-xs text-muted';

export const METASTORE_STEPPER_LIST_CLASSES =
  'flex flex-wrap items-center gap-3 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

export const METASTORE_STEPPER_BADGE_BASE_CLASSES =
  'flex items-center gap-2 rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] transition-colors';

export const METASTORE_STEPPER_BADGE_ACTIVE_CLASSES = 'border-accent text-accent';

export const METASTORE_STEPPER_BADGE_COMPLETED_CLASSES = 'border-status-success text-status-success';

export const METASTORE_STEPPER_BADGE_PENDING_CLASSES = 'border-subtle text-muted';

export const METASTORE_PRIMARY_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_PRIMARY_BUTTON_SMALL_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-3 py-1 text-scale-xs font-weight-semibold text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_SECONDARY_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-4 py-2 text-scale-sm font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_SECONDARY_BUTTON_SMALL_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_SEGMENTED_CONTAINER_CLASSES =
  'flex overflow-hidden rounded-full border border-subtle bg-surface-muted';

export const METASTORE_SEGMENTED_BUTTON_BASE_CLASSES =
  'px-4 py-1 text-scale-sm font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const METASTORE_SEGMENTED_BUTTON_ACTIVE_CLASSES = 'bg-surface-sunken text-primary';

export const METASTORE_SEGMENTED_BUTTON_INACTIVE_CLASSES = 'text-secondary hover:bg-accent-soft/60';

export const METASTORE_TEXT_AREA_MONO_CLASSES =
  'w-full rounded-2xl border border-subtle bg-surface-glass px-3 py-2 font-mono text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const METASTORE_INPUT_FIELD_CLASSES =
  'w-full rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const METASTORE_CHECKBOX_CLASSES = 'h-4 w-4 rounded border-subtle text-accent focus:ring-accent';

export const METASTORE_SELECT_CLASSES =
  'rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-sm text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const METASTORE_ALERT_SUCCESS_CLASSES =
  'rounded-2xl border border-status-success bg-status-success-soft px-4 py-3 text-scale-sm text-status-success';

export const METASTORE_ALERT_ERROR_CLASSES =
  'rounded-2xl border border-status-danger bg-status-danger-soft px-4 py-3 text-scale-sm text-status-danger';

export const METASTORE_SUMMARY_CARD_CLASSES =
  'rounded-2xl border border-subtle bg-surface-muted p-3 text-scale-sm text-secondary';

export const METASTORE_SUMMARY_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

export const METASTORE_SUMMARY_VALUE_SUCCESS_CLASSES = 'text-scale-lg font-weight-semibold text-status-success';

export const METASTORE_SUMMARY_VALUE_NEUTRAL_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

export const METASTORE_SUMMARY_VALUE_DANGER_CLASSES = 'text-scale-lg font-weight-semibold text-status-danger';

export const METASTORE_RESULT_LIST_CONTAINER_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-4 text-scale-sm text-secondary';

export const METASTORE_RESULT_BADGE_BASE_CLASSES =
  'rounded-full px-2 py-[2px] text-scale-xs font-weight-semibold uppercase tracking-wide';

export const METASTORE_RESULT_BADGE_SUCCESS_CLASSES = 'bg-status-success-soft text-status-success';

export const METASTORE_RESULT_BADGE_ERROR_CLASSES = 'bg-status-danger-soft text-status-danger';

export const METASTORE_RESULT_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

export const METASTORE_RESULT_META_CLASSES = 'text-scale-xs text-muted';

export const METASTORE_LINK_ACCENT_CLASSES =
  'text-scale-xs font-weight-semibold text-accent underline decoration-dotted transition-colors hover:decoration-solid hover:text-accent-strong';

export const METASTORE_PILL_BADGE_NEUTRAL_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary';

export const METASTORE_CHIP_WARNING_CLASSES =
  'inline-flex items-center rounded-full border border-status-warning bg-status-warning-soft px-2 py-[2px] text-scale-xs font-weight-semibold text-status-warning';

export const METASTORE_FORM_FIELD_CONTAINER_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-4 transition-colors';

export const METASTORE_STATUS_ROW_TEXT_CLASSES = 'text-scale-xs text-muted';

export const METASTORE_TABLE_CONTAINER_CLASSES =
  'rounded-3xl border border-subtle bg-surface-glass shadow-elevation-xl transition-colors';

export const METASTORE_TABLE_HEADER_CLASSES =
  'flex items-center justify-between gap-3 border-b border-subtle px-5 py-4';

export const METASTORE_TABLE_HEADER_TITLE_CLASSES = 'text-scale-base font-weight-semibold text-primary';

export const METASTORE_TABLE_HEADER_META_CLASSES = 'text-scale-xs text-muted';

export const METASTORE_TABLE_REFRESH_BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible-outline-2 focus-visible-outline-offset-2 focus-visible-outline-accent';

export const METASTORE_TABLE_BODY_CLASSES = 'max-h-[520px] overflow-y-auto';

export const METASTORE_TABLE_EMPTY_CLASSES = 'px-5 py-6 text-scale-sm text-muted';

export const METASTORE_TABLE_ERROR_CONTAINER_CLASSES =
  'flex flex-col gap-3 px-5 py-6 text-scale-sm text-status-danger';

export const METASTORE_TABLE_ROW_CLASSES =
  'flex w-full flex-col items-start gap-1 border-b border-subtle px-5 py-4 text-left transition-colors last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const METASTORE_TABLE_ROW_ACTIVE_CLASSES = 'bg-accent-soft/20 text-accent-strong';

export const METASTORE_TABLE_ROW_INACTIVE_CLASSES = 'text-secondary';

export const METASTORE_TAG_BADGE_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-muted px-2 py-[2px] text-scale-xs font-weight-medium text-secondary';
