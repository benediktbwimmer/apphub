const rateLimitConfigs = parseRateLimitConfig();
const sourceWindows = new Map<string, number[]>();
const pausedSources = new Map<string, SourcePauseState>();
const triggerFailures = new Map<string, number[]>();
const pausedTriggers = new Map<string, TriggerPauseState>();

const triggerErrorThreshold = normalizeNumber(process.env.EVENT_TRIGGER_ERROR_THRESHOLD, 5);
const triggerErrorWindowMs = normalizeNumber(process.env.EVENT_TRIGGER_ERROR_WINDOW_MS, 5 * 60 * 1000);
const triggerPauseMs = normalizeNumber(process.env.EVENT_TRIGGER_PAUSE_MS, 5 * 60 * 1000);

interface RateLimitConfig {
  source: string;
  limit: number;
  intervalMs: number;
  pauseMs: number;
}

interface SourcePauseState {
  until: number;
  reason: string;
  details?: Record<string, unknown>;
}

interface TriggerPauseState {
  until: number;
  reason: string;
  failures: number;
}

function normalizeNumber(source: string | undefined, fallback: number): number {
  if (!source) {
    return fallback;
  }
  const value = Number(source);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseRateLimitConfig(): Map<string, RateLimitConfig> {
  const map = new Map<string, RateLimitConfig>();
  const raw = process.env.EVENT_SOURCE_RATE_LIMITS;
  if (!raw) {
    return map;
  }
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    for (const entry of parsed) {
      const source = typeof entry.source === 'string' ? entry.source.trim() : '';
      const limit = Number(entry.limit);
      const intervalMs = Number(entry.intervalMs ?? entry.windowMs ?? 60_000);
      const pauseMs = Number(entry.pauseMs ?? intervalMs);
      if (!source || !Number.isFinite(limit) || limit <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        continue;
      }
      map.set(source, {
        source,
        limit: Math.floor(limit),
        intervalMs: Math.floor(intervalMs),
        pauseMs: Number.isFinite(pauseMs) && pauseMs > 0 ? Math.floor(pauseMs) : Math.floor(intervalMs)
      });
    }
  } catch (err) {
    console.error('[events] Failed to parse EVENT_SOURCE_RATE_LIMITS', err);
  }
  return map;
}

function cleanupExpiredSourcePause(source: string): void {
  const pause = pausedSources.get(source);
  if (pause && pause.until <= Date.now()) {
    pausedSources.delete(source);
  }
}

function cleanupExpiredTriggerPause(triggerId: string): void {
  const pause = pausedTriggers.get(triggerId);
  if (pause && pause.until <= Date.now()) {
    pausedTriggers.delete(triggerId);
  }
}

function lookupRateLimit(source: string): RateLimitConfig | undefined {
  const config = rateLimitConfigs.get(source);
  if (config) {
    return config;
  }
  return rateLimitConfigs.get('*');
}

export function registerSourceEvent(source: string | null | undefined): {
  allowed: boolean;
  reason?: string;
  until?: string;
} {
  const normalizedSource = (source ?? 'unknown').trim() || 'unknown';
  cleanupExpiredSourcePause(normalizedSource);
  const pause = pausedSources.get(normalizedSource);
  if (pause) {
    return { allowed: false, reason: pause.reason, until: new Date(pause.until).toISOString() };
  }

  const config = lookupRateLimit(normalizedSource);
  if (!config) {
    return { allowed: true };
  }

  const now = Date.now();
  const window = sourceWindows.get(normalizedSource) ?? [];
  const threshold = now - config.intervalMs;
  while (window.length > 0 && window[0] <= threshold) {
    window.shift();
  }
  window.push(now);
  sourceWindows.set(normalizedSource, window);

  if (window.length > config.limit) {
    const until = now + config.pauseMs;
    pausedSources.set(normalizedSource, {
      until,
      reason: 'rate_limit',
      details: {
        limit: config.limit,
        intervalMs: config.intervalMs
      }
    });
    return { allowed: false, reason: 'rate_limit', until: new Date(until).toISOString() };
  }

  return { allowed: true };
}

export function recordManualSourcePause(
  source: string,
  ms: number,
  reason: string,
  details?: Record<string, unknown>
): void {
  const until = Date.now() + Math.max(ms, 1_000);
  pausedSources.set(source, { until, reason, details });
}

export function isTriggerPaused(triggerId: string): {
  paused: boolean;
  until?: string;
  reason?: string;
} {
  cleanupExpiredTriggerPause(triggerId);
  const pause = pausedTriggers.get(triggerId);
  if (!pause) {
    return { paused: false };
  }
  return {
    paused: true,
    until: new Date(pause.until).toISOString(),
    reason: pause.reason
  };
}

export function registerTriggerFailure(triggerId: string, reason: string | null = null): {
  paused: boolean;
  until?: string;
} {
  const now = Date.now();
  const window = triggerFailures.get(triggerId) ?? [];
  const threshold = now - triggerErrorWindowMs;
  while (window.length > 0 && window[0] <= threshold) {
    window.shift();
  }
  window.push(now);
  triggerFailures.set(triggerId, window);

  if (window.length >= triggerErrorThreshold) {
    const until = now + triggerPauseMs;
    pausedTriggers.set(triggerId, {
      until,
      reason: reason ?? 'failure_threshold_exceeded',
      failures: window.length
    });
    return { paused: true, until: new Date(until).toISOString() };
  }
  return { paused: false };
}

export function registerTriggerSuccess(triggerId: string): void {
  triggerFailures.delete(triggerId);
  cleanupExpiredTriggerPause(triggerId);
}

export function getSourcePauseStates(): Array<{
  source: string;
  reason: string;
  until: string;
  details?: Record<string, unknown>;
}> {
  const now = Date.now();
  return Array.from(pausedSources.entries())
    .filter(([, pause]) => pause.until > now)
    .map(([source, pause]) => ({
      source,
      reason: pause.reason,
      until: new Date(pause.until).toISOString(),
      details: pause.details
    }));
}

export function getTriggerPauseStates(): Array<{
  triggerId: string;
  until: string;
  reason: string;
  failures: number;
}> {
  const now = Date.now();
  return Array.from(pausedTriggers.entries())
    .filter(([, pause]) => pause.until > now)
    .map(([triggerId, pause]) => ({
      triggerId,
      until: new Date(pause.until).toISOString(),
      reason: pause.reason,
      failures: pause.failures
    }));
}

export function getRateLimitConfiguration(): RateLimitConfig[] {
  return Array.from(rateLimitConfigs.values());
}
