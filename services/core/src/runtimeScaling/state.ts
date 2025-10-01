import type { RuntimeScalingSnapshot } from './policies';
import type { RuntimeScalingTargetKey } from './targets';

const snapshots = new Map<RuntimeScalingTargetKey, RuntimeScalingSnapshot>();

export function setRuntimeScalingSnapshot(snapshot: RuntimeScalingSnapshot): void {
  snapshots.set(snapshot.target, snapshot);
}

export function getRuntimeScalingSnapshot(target: RuntimeScalingTargetKey): RuntimeScalingSnapshot | null {
  return snapshots.get(target) ?? null;
}

export function getRuntimeScalingEffectiveConcurrency(target: RuntimeScalingTargetKey): number | null {
  const snapshot = snapshots.get(target);
  if (!snapshot) {
    return null;
  }
  const value = Number(snapshot.effectiveConcurrency);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

export function clearRuntimeScalingSnapshots(): void {
  snapshots.clear();
}
