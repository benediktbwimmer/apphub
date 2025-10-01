import {
  evaluateSourceEvent,
  getActiveSourcePauses,
  getActiveTriggerPauses,
  isTriggerPausedInStore,
  recordManualSourcePause as persistManualSourcePause,
  registerTriggerFailureInStore,
  registerTriggerSuccessInStore,
  type RateLimitConfig
} from './db/eventScheduler';
import type { JsonValue } from './db/types';

const rateLimitConfigs = parseRateLimitConfig();

const triggerErrorThreshold = normalizeNumber(process.env.EVENT_TRIGGER_ERROR_THRESHOLD, 5);
const triggerErrorWindowMs = normalizeNumber(process.env.EVENT_TRIGGER_ERROR_WINDOW_MS, 5 * 60 * 1000);
const triggerPauseMs = normalizeNumber(process.env.EVENT_TRIGGER_PAUSE_MS, 5 * 60 * 1000);

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

function lookupRateLimit(source: string): RateLimitConfig | undefined {
  const config = rateLimitConfigs.get(source);
  if (config) {
    return config;
  }
  return rateLimitConfigs.get('*');
}

export function registerSourceEvent(source: string | null | undefined): Promise<{
  allowed: boolean;
  reason?: string;
  until?: string;
}> {
  const normalizedSource = (source ?? 'unknown').trim() || 'unknown';
  const config = lookupRateLimit(normalizedSource);
  return evaluateSourceEvent(normalizedSource, config);
}

export async function recordManualSourcePause(
  source: string,
  ms: number,
  reason: string,
  details?: JsonValue
): Promise<void> {
  const until = new Date(Date.now() + Math.max(ms, 1_000));
  await persistManualSourcePause(source, until, reason, details);
}

export function isTriggerPaused(triggerId: string): Promise<{
  paused: boolean;
  until?: string;
  reason?: string;
}> {
  return isTriggerPausedInStore(triggerId);
}

export function registerTriggerFailure(
  triggerId: string,
  reason: string | null = null
): Promise<{ paused: boolean; until?: string }> {
  return registerTriggerFailureInStore(
    triggerId,
    reason,
    triggerErrorThreshold,
    triggerErrorWindowMs,
    triggerPauseMs
  );
}

export function registerTriggerSuccess(triggerId: string): Promise<void> {
  return registerTriggerSuccessInStore(triggerId);
}

export function getSourcePauseStates(): Promise<Array<{
  source: string;
  reason: string;
  until: string;
  details?: JsonValue;
}>> {
  return getActiveSourcePauses();
}

export function getTriggerPauseStates(): Promise<Array<{
  triggerId: string;
  until: string;
  reason: string;
  failures: number;
}>> {
  return getActiveTriggerPauses();
}

export function getRateLimitConfiguration(): RateLimitConfig[] {
  return Array.from(rateLimitConfigs.values());
}
