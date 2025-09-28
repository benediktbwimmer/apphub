export function deriveManifestShardKey(timestamp: Date): string {
  const ms = timestamp.getTime();
  if (!Number.isFinite(ms)) {
    throw new Error('Cannot derive manifest shard for invalid timestamp');
  }
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 10);
}

export function listManifestShardsForRange(rangeStart: Date, rangeEnd: Date): string[] {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return [];
  }

  const shards: string[] = [];
  const cursor = new Date(Date.UTC(
    rangeStart.getUTCFullYear(),
    rangeStart.getUTCMonth(),
    rangeStart.getUTCDate()
  ));
  const endDate = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate()));

  while (cursor <= endDate) {
    shards.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return shards;
}
