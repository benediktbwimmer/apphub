export type StatusTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

type StatusToneConfig = {
  tone: StatusTone;
  extraClasses?: string;
};

const STATUS_MAP: Record<string, StatusToneConfig> = {
  succeeded: { tone: 'success' },
  success: { tone: 'success' },
  completed: { tone: 'success' },
  ready: { tone: 'success' },
  healthy: { tone: 'success' },
  running: { tone: 'info', extraClasses: 'running-badge' },
  processing: { tone: 'info' },
  building: { tone: 'info' },
  starting: { tone: 'info' },
  pending: { tone: 'warning' },
  queued: { tone: 'warning' },
  stopping: { tone: 'warning' },
  paused: { tone: 'warning' },
  degraded: { tone: 'warning' },
  'awaiting input': { tone: 'warning' },
  'awaiting inputs': { tone: 'warning' },
  unreachable: { tone: 'danger' },
  canceled: { tone: 'warning' },
  cancelled: { tone: 'warning' },
  failed: { tone: 'danger' },
  error: { tone: 'danger' },
  offline: { tone: 'danger' },
  stopped: { tone: 'neutral' },
  seed: { tone: 'info' },
  unknown: { tone: 'neutral' }
};

const KEYWORD_TONES: Array<{ pattern: RegExp; tone: StatusTone }> = [
  { pattern: /(fail|error|panic|crash|fatal|invalid|offline|danger|blocked)/, tone: 'danger' },
  { pattern: /(warn|degrad|skip|cancel|stop|pause|queue|pending|idle)/, tone: 'warning' },
  { pattern: /(success|ready|complete|healthy|available|active|connected)/, tone: 'success' },
  { pattern: /(run|process|build|start|sync|seed|ingest|connect)/, tone: 'info' }
];

const TONE_CLASS_MAP: Record<StatusTone, string> = {
  info: 'border-status-info bg-status-info-soft text-status-info',
  success: 'border-status-success bg-status-success-soft text-status-success',
  warning: 'border-status-warning bg-status-warning-soft text-status-warning',
  danger: 'border-status-danger bg-status-danger-soft text-status-danger',
  neutral: 'border-status-neutral bg-status-neutral-soft text-status-neutral'
};

export function getStatusToneClasses(status: string | null | undefined): string {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) {
    return TONE_CLASS_MAP.neutral;
  }

  const override = STATUS_MAP[normalized];
  if (override) {
    const toneClasses = TONE_CLASS_MAP[override.tone];
    return override.extraClasses ? `${toneClasses} ${override.extraClasses}` : toneClasses;
  }

  const keywordMatch = KEYWORD_TONES.find(({ pattern }) => pattern.test(normalized));
  if (keywordMatch) {
    return TONE_CLASS_MAP[keywordMatch.tone];
  }

  return TONE_CLASS_MAP.neutral;
}
