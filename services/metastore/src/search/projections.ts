export const DEFAULT_SUMMARY_PROJECTION: ReadonlyArray<string> = Object.freeze([
  'namespace',
  'key',
  'version',
  'updatedAt',
  'owner',
  'schemaHash',
  'tags',
  'deletedAt'
]);

export function normalizeProjectionInput(projection?: string[]): string[] {
  if (!projection || projection.length === 0) {
    return [];
  }
  return projection.map((entry) => entry.trim()).filter(Boolean);
}

export function resolveProjection(
  projection: string[] | undefined,
  summary?: boolean
): string[] | undefined {
  const normalized = normalizeProjectionInput(projection);

  if (summary) {
    const merged = new Set(DEFAULT_SUMMARY_PROJECTION);
    for (const entry of normalized) {
      merged.add(entry);
    }
    return Array.from(merged);
  }

  return normalized.length > 0 ? normalized : undefined;
}
