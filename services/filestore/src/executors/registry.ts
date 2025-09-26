import type { CommandExecutor } from './types';

const executors = new Map<string, CommandExecutor>();

export function registerExecutor(executor: CommandExecutor): void {
  executors.set(executor.kind, executor);
}

export function clearExecutors(): void {
  executors.clear();
}

export function resolveExecutor(
  kind: string,
  overrides?: Map<string, CommandExecutor>
): CommandExecutor | undefined {
  if (overrides?.has(kind)) {
    return overrides.get(kind);
  }
  return executors.get(kind);
}

export function listExecutors(): CommandExecutor[] {
  return Array.from(executors.values());
}
