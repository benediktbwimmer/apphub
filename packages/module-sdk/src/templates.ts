import type { CapabilitySelector } from './runtime/capabilities';

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Template references require a non-empty path');
  }
  return trimmed;
}

export function moduleSetting(path: string): string {
  return `{{ module.settings.${normalizePath(path)} }}`;
}

export function moduleSecret(path: string): string {
  return `{{ module.secrets.${normalizePath(path)} }}`;
}

export function capability(path: CapabilitySelector): string {
  return `{{ module.capabilities.${normalizePath(path)} }}`;
}
