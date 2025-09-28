import IORedis, { type Redis } from 'ioredis';
import { loadServiceConfig } from '../config/serviceConfig';
import {
  listPublishedManifests,
  listPublishedManifestsForRange,
  listPartitionsForQuery,
  getManifestById,
  getPartitionsWithTargetsForManifest,
  type DatasetManifestRecord,
  type DatasetManifestWithPartitions,
  type DatasetRecord,
  type PartitionWithTarget
} from '../db/metadata';
import type {
  PartitionFilters,
  StringPartitionKeyPredicate,
  NumberPartitionKeyPredicate,
  TimestampPartitionKeyPredicate
} from '../types/partitionFilters';
import {
  recordManifestCacheEviction,
  recordManifestCacheHit,
  recordManifestCacheMiss
} from '../observability/metrics';

interface ManifestCacheOptions {
  enabled: boolean;
  redisUrl: string;
  keyPrefix: string;
  ttlMillis: number;
  inline: boolean;
}

interface CacheManifestRecord
  extends Pick<
    DatasetManifestRecord,
    | 'id'
    | 'datasetId'
    | 'version'
    | 'status'
    | 'schemaVersionId'
    | 'parentManifestId'
    | 'manifestShard'
    | 'summary'
    | 'statistics'
    | 'metadata'
    | 'partitionCount'
    | 'totalRows'
    | 'totalBytes'
    | 'createdBy'
    | 'createdAt'
    | 'updatedAt'
    | 'publishedAt'
  > {}

interface CachePartitionRecord
  extends Pick<
    PartitionWithTarget,
    | 'id'
    | 'datasetId'
    | 'manifestId'
    | 'manifestShard'
    | 'partitionKey'
    | 'storageTarget'
    | 'storageTargetId'
    | 'fileFormat'
    | 'filePath'
    | 'fileSizeBytes'
    | 'rowCount'
    | 'startTime'
    | 'endTime'
    | 'checksum'
    | 'metadata'
    | 'createdAt'
  > {}

interface ManifestCacheEntry {
  datasetSlug: string;
  manifest: CacheManifestRecord;
  partitions: CachePartitionRecord[];
  cachedAt: string;
}

interface ManifestIndexShardEntry {
  key: string;
  manifestId: string;
  manifestVersion: number;
  updatedAt: string;
  cachedAt: string;
}

interface ManifestIndex {
  datasetId: string;
  datasetSlug: string;
  shards: Record<string, ManifestIndexShardEntry>;
  cachedAt: string;
}

interface ShardEntryResult {
  entry: ManifestCacheEntry | null;
  updatedShard?: ManifestIndexShardEntry;
  remove?: boolean;
}

interface CacheLoadResult {
  manifests: DatasetManifestRecord[];
  partitions: PartitionWithTarget[];
  shards: string[];
  cacheUsed: boolean;
}

interface EntryHitResult {
  entry: ManifestCacheEntry | null;
  source: 'memory' | 'redis' | 'miss';
}

type PartitionKeyMap = Record<string, unknown>;

type CacheMissReason = 'disabled' | 'index' | 'entry' | 'stale' | 'error';

type CacheHitSource = 'memory' | 'redis';

type CacheEvictionReason = 'invalidate' | 'rebuild';

let redisClient: Redis | null = null;

const entryCache = new Map<string, { value: ManifestCacheEntry; expiresAt: number }>();
const indexCache = new Map<string, { value: ManifestIndex; expiresAt: number }>();

function loadOptions(): ManifestCacheOptions {
  const config = loadServiceConfig();
  const manifestCache = config.query.manifestCache;
  return {
    enabled: manifestCache.enabled,
    redisUrl: manifestCache.redisUrl,
    keyPrefix: manifestCache.keyPrefix,
    ttlMillis: Math.max(manifestCache.ttlSeconds, 1) * 1000,
    inline: manifestCache.inline
  } satisfies ManifestCacheOptions;
}

function ensureRedis(options: ManifestCacheOptions): Redis {
  if (options.inline) {
    throw new Error('Redis connection requested in inline mode');
  }
  if (redisClient) {
    return redisClient;
  }
  redisClient = new IORedis(options.redisUrl, {
    maxRetriesPerRequest: null
  });
  redisClient.on('error', (err) => {
    console.error('[timestore:manifest-cache] Redis error', err);
  });
  return redisClient;
}

function buildIndexKey(options: ManifestCacheOptions, datasetSlug: string): string {
  return `${options.keyPrefix}:index:${datasetSlug}`;
}

function encodeShard(shard: string): string {
  return Buffer.from(shard, 'utf8').toString('base64url');
}

function buildEntryKey(
  options: ManifestCacheOptions,
  datasetSlug: string,
  shard: string,
  version: number
): string {
  return `${options.keyPrefix}:entry:${datasetSlug}:${encodeShard(shard)}:${version}`;
}

function now(): number {
  return Date.now();
}

function recordHit(source: CacheHitSource): void {
  recordManifestCacheHit(source);
}

function recordMiss(reason: CacheMissReason): void {
  recordManifestCacheMiss(reason);
}

function recordEviction(reason: CacheEvictionReason): void {
  recordManifestCacheEviction(reason);
}

function readLocalIndex(datasetSlug: string): ManifestIndex | null {
  const entry = indexCache.get(datasetSlug);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < now()) {
    indexCache.delete(datasetSlug);
    return null;
  }
  return entry.value;
}

function writeLocalIndex(datasetSlug: string, value: ManifestIndex, ttlMillis: number): void {
  indexCache.set(datasetSlug, {
    value,
    expiresAt: now() + ttlMillis
  });
}

function deleteLocalIndex(datasetSlug: string): void {
  indexCache.delete(datasetSlug);
}

function readLocalEntry(cacheKey: string): ManifestCacheEntry | null {
  const entry = entryCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt < now()) {
    entryCache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function writeLocalEntry(cacheKey: string, value: ManifestCacheEntry, ttlMillis: number): void {
  entryCache.set(cacheKey, {
    value,
    expiresAt: now() + ttlMillis
  });
}

function deleteLocalEntry(cacheKey: string): void {
  entryCache.delete(cacheKey);
}

async function readIndex(
  options: ManifestCacheOptions,
  datasetSlug: string
): Promise<ManifestIndex | null> {
  const local = readLocalIndex(datasetSlug);
  if (local) {
    recordHit('memory');
    return local;
  }

  if (options.inline) {
    recordMiss('index');
    return null;
  }

  try {
    const client = ensureRedis(options);
    const payload = await client.get(buildIndexKey(options, datasetSlug));
    if (!payload) {
      recordMiss('index');
      return null;
    }
    const parsed = JSON.parse(payload) as ManifestIndex;
    writeLocalIndex(datasetSlug, parsed, options.ttlMillis);
    recordHit('redis');
    return parsed;
  } catch (err) {
    console.warn('[timestore:manifest-cache] failed to read index from redis', err);
    recordMiss('error');
    return null;
  }
}

async function writeIndex(
  options: ManifestCacheOptions,
  datasetSlug: string,
  index: ManifestIndex
): Promise<void> {
  writeLocalIndex(datasetSlug, index, options.ttlMillis);
  if (options.inline) {
    return;
  }
  try {
    const client = ensureRedis(options);
    await client.set(buildIndexKey(options, datasetSlug), JSON.stringify(index), 'PX', options.ttlMillis);
  } catch (err) {
    console.warn('[timestore:manifest-cache] failed to write index to redis', err);
  }
}

async function deleteIndex(options: ManifestCacheOptions, datasetSlug: string): Promise<void> {
  deleteLocalIndex(datasetSlug);
  if (options.inline) {
    return;
  }
  try {
    const client = ensureRedis(options);
    await client.del(buildIndexKey(options, datasetSlug));
  } catch (err) {
    console.warn('[timestore:manifest-cache] failed to delete index from redis', err);
  }
}

async function readEntry(options: ManifestCacheOptions, cacheKey: string): Promise<EntryHitResult> {
  const local = readLocalEntry(cacheKey);
  if (local) {
    recordHit('memory');
    return { entry: local, source: 'memory' } satisfies EntryHitResult;
  }

  if (options.inline) {
    recordMiss('entry');
    return { entry: null, source: 'miss' } satisfies EntryHitResult;
  }

  try {
    const client = ensureRedis(options);
    const payload = await client.get(cacheKey);
    if (!payload) {
      recordMiss('entry');
      return { entry: null, source: 'miss' } satisfies EntryHitResult;
    }
    const parsed = JSON.parse(payload) as ManifestCacheEntry;
    writeLocalEntry(cacheKey, parsed, options.ttlMillis);
    recordHit('redis');
    return { entry: parsed, source: 'redis' } satisfies EntryHitResult;
  } catch (err) {
    console.warn('[timestore:manifest-cache] failed to read entry from redis', err);
    recordMiss('error');
    return { entry: null, source: 'miss' } satisfies EntryHitResult;
  }
}

async function writeEntry(
  options: ManifestCacheOptions,
  cacheKey: string,
  entry: ManifestCacheEntry
): Promise<void> {
  writeLocalEntry(cacheKey, entry, options.ttlMillis);
  if (options.inline) {
    return;
  }
  try {
    const client = ensureRedis(options);
    await client.set(cacheKey, JSON.stringify(entry), 'PX', options.ttlMillis);
  } catch (err) {
    console.warn('[timestore:manifest-cache] failed to write entry to redis', err);
  }
}

async function deleteEntry(options: ManifestCacheOptions, cacheKey: string): Promise<void> {
  deleteLocalEntry(cacheKey);
  if (options.inline) {
    return;
  }
  try {
    const client = ensureRedis(options);
    await client.del(cacheKey);
  } catch (err) {
    console.warn('[timestore:manifest-cache] failed to delete entry from redis', err);
  }
}

async function rebuildIndex(
  options: ManifestCacheOptions,
  dataset: Pick<DatasetRecord, 'id' | 'slug'>
): Promise<ManifestIndex> {
  const manifests = await listPublishedManifests(dataset.id);
  if (manifests.length === 0) {
    const emptyIndex: ManifestIndex = {
      datasetId: dataset.id,
      datasetSlug: dataset.slug,
      shards: {},
      cachedAt: new Date().toISOString()
    };
    await writeIndex(options, dataset.slug, emptyIndex);
    return emptyIndex;
  }
  const latestByShard = new Map<string, DatasetManifestRecord>();
  for (const manifest of manifests) {
    if (!latestByShard.has(manifest.manifestShard)) {
      latestByShard.set(manifest.manifestShard, manifest);
    }
  }

  const shards: Record<string, ManifestIndexShardEntry> = {};
  for (const [shard, manifest] of latestByShard.entries()) {
    const { cacheKey, cachedAt } = await storeManifestEntry(options, dataset, manifest);
    shards[shard] = {
      key: cacheKey,
      manifestId: manifest.id,
      manifestVersion: manifest.version,
      updatedAt: manifest.updatedAt,
      cachedAt
    } satisfies ManifestIndexShardEntry;
  }

  const index: ManifestIndex = {
    datasetId: dataset.id,
    datasetSlug: dataset.slug,
    shards,
    cachedAt: new Date().toISOString()
  } satisfies ManifestIndex;
  await writeIndex(options, dataset.slug, index);
  return index;
}

async function ensureIndex(
  options: ManifestCacheOptions,
  dataset: Pick<DatasetRecord, 'id' | 'slug'>
): Promise<ManifestIndex> {
  const existing = await readIndex(options, dataset.slug);
  if (existing && existing.datasetId === dataset.id) {
    return existing;
  }
  return rebuildIndex(options, dataset);
}

async function ensureEntryForShard(
  options: ManifestCacheOptions,
  dataset: Pick<DatasetRecord, 'id' | 'slug'>,
  shardEntry: ManifestIndexShardEntry,
  _shard: string
): Promise<ShardEntryResult> {
  const { entry } = await readEntry(options, shardEntry.key);
  if (entry && entry.manifest.version === shardEntry.manifestVersion) {
    return { entry };
  }

  const manifest = await getManifestById(shardEntry.manifestId);
  if (!manifest) {
    await deleteEntry(options, shardEntry.key);
    recordEviction('rebuild');
    return { entry: null, remove: true } satisfies ShardEntryResult;
  }
  const { partitions: _partitions, ...rest } = manifest;
  const refreshedManifest: DatasetManifestRecord = rest;

  const { cacheKey, cachedAt } = await storeManifestEntry(options, dataset, refreshedManifest);
  const refreshed = (await readEntry(options, cacheKey)).entry;
  if (!refreshed) {
    return { entry: null } satisfies ShardEntryResult;
  }
  const updatedShard: ManifestIndexShardEntry = {
    key: cacheKey,
    manifestId: refreshedManifest.id,
    manifestVersion: refreshedManifest.version,
    updatedAt: refreshedManifest.updatedAt,
    cachedAt
  } satisfies ManifestIndexShardEntry;
  return { entry: refreshed, updatedShard } satisfies ShardEntryResult;
}

async function storeManifestEntry(
  options: ManifestCacheOptions,
  dataset: Pick<DatasetRecord, 'id' | 'slug'>,
  manifest: DatasetManifestRecord,
  partitionsWithTargets?: PartitionWithTarget[]
): Promise<{ cacheKey: string; cachedAt: string }> {
  let partitions = partitionsWithTargets;
  if (!partitions) {
    partitions = await getPartitionsWithTargetsForManifest(manifest.id);
  }
  const cacheKey = buildEntryKey(options, dataset.slug, manifest.manifestShard, manifest.version);
  const cachedAt = new Date().toISOString();
  const entry: ManifestCacheEntry = {
    datasetSlug: dataset.slug,
    manifest: {
      ...manifest,
      summary: manifest.summary,
      statistics: manifest.statistics,
      metadata: manifest.metadata
    },
    partitions: partitions.map((partition) => ({
      ...partition,
      storageTarget: partition.storageTarget
    })),
    cachedAt
  } satisfies ManifestCacheEntry;
  await writeEntry(options, cacheKey, entry);
  return { cacheKey, cachedAt };
}

function partitionOverlapsRange(
  partition: CachePartitionRecord,
  rangeStart: Date,
  rangeEnd: Date
): boolean {
  const partitionStart = new Date(partition.startTime);
  const partitionEnd = new Date(partition.endTime);
  return partitionEnd >= rangeStart && partitionStart <= rangeEnd;
}

function matchesPartitionFilters(
  partitionKey: PartitionKeyMap,
  filters: PartitionFilters
): boolean {
  const predicates = filters.partitionKey ?? {};
  for (const [key, predicate] of Object.entries(predicates)) {
    if (!predicate) {
      continue;
    }
    const value = partitionKey[key];
    switch (predicate.type) {
      case 'string':
        if (!matchesStringPredicate(value, predicate)) {
          return false;
        }
        break;
      case 'number':
        if (!matchesNumberPredicate(value, predicate)) {
          return false;
        }
        break;
      case 'timestamp':
        if (!matchesTimestampPredicate(value, predicate)) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

function matchesStringPredicate(
  value: unknown,
  predicate: StringPartitionKeyPredicate
): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  const stringValue = String(value);
  if (typeof predicate.eq === 'string' && predicate.eq !== stringValue) {
    return false;
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    if (!predicate.in.includes(stringValue)) {
      return false;
    }
  }
  return true;
}

function matchesNumberPredicate(
  value: unknown,
  predicate: NumberPartitionKeyPredicate
): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return false;
  }
  if (predicate.eq !== undefined && numericValue !== Number(predicate.eq)) {
    return false;
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const candidates = predicate.in.map(Number);
    if (!candidates.includes(numericValue)) {
      return false;
    }
  }
  if (predicate.gt !== undefined && !(numericValue > Number(predicate.gt))) {
    return false;
  }
  if (predicate.gte !== undefined && !(numericValue >= Number(predicate.gte))) {
    return false;
  }
  if (predicate.lt !== undefined && !(numericValue < Number(predicate.lt))) {
    return false;
  }
  if (predicate.lte !== undefined && !(numericValue <= Number(predicate.lte))) {
    return false;
  }
  return true;
}

function matchesTimestampPredicate(
  value: unknown,
  predicate: TimestampPartitionKeyPredicate
): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return false;
  }
  if (typeof predicate.eq === 'string') {
    const eqTime = new Date(predicate.eq);
    if (Number.isNaN(eqTime.getTime()) || timestamp.getTime() !== eqTime.getTime()) {
      return false;
    }
  }
  if (Array.isArray(predicate.in) && predicate.in.length > 0) {
    const matches = predicate.in.some((entry) => {
      const candidate = new Date(entry);
      return !Number.isNaN(candidate.getTime()) && candidate.getTime() === timestamp.getTime();
    });
    if (!matches) {
      return false;
    }
  }
  if (typeof predicate.gt === 'string') {
    const bound = new Date(predicate.gt);
    if (Number.isNaN(bound.getTime()) || !(timestamp > bound)) {
      return false;
    }
  }
  if (typeof predicate.gte === 'string') {
    const bound = new Date(predicate.gte);
    if (Number.isNaN(bound.getTime()) || !(timestamp >= bound)) {
      return false;
    }
  }
  if (typeof predicate.lt === 'string') {
    const bound = new Date(predicate.lt);
    if (Number.isNaN(bound.getTime()) || !(timestamp < bound)) {
      return false;
    }
  }
  if (typeof predicate.lte === 'string') {
    const bound = new Date(predicate.lte);
    if (Number.isNaN(bound.getTime()) || !(timestamp <= bound)) {
      return false;
    }
  }
  return true;
}

function toManifestRecord(entry: ManifestCacheEntry): DatasetManifestRecord {
  return {
    ...entry.manifest,
    datasetId: entry.manifest.datasetId,
    summary: entry.manifest.summary,
    statistics: entry.manifest.statistics,
    metadata: entry.manifest.metadata
  } satisfies DatasetManifestRecord;
}

function toPartitionWithTarget(partition: CachePartitionRecord): PartitionWithTarget {
  return {
    ...partition,
    storageTarget: partition.storageTarget
  } satisfies PartitionWithTarget;
}

export async function loadManifestPartitionsForQuery(
  dataset: DatasetRecord,
  rangeStart: Date,
  rangeEnd: Date,
  filters: PartitionFilters = {}
): Promise<CacheLoadResult> {
  const options = loadOptions();
  if (!options.enabled) {
    recordMiss('disabled');
    return fallbackQuery(dataset, rangeStart, rangeEnd, filters);
  }

  const index = await ensureIndex(options, dataset);
  if (Object.keys(index.shards).length === 0) {
    return {
      manifests: [],
      partitions: [],
      shards: [],
      cacheUsed: true
    } satisfies CacheLoadResult;
  }

  const manifests: DatasetManifestRecord[] = [];
  const partitions: PartitionWithTarget[] = [];
  const visitedShards: string[] = [];
  let indexDirty = false;

  for (const [shard, shardEntry] of Object.entries(index.shards)) {
    const result = await ensureEntryForShard(options, dataset, shardEntry, shard);
    if (result.remove) {
      delete index.shards[shard];
      indexDirty = true;
      continue;
    }
    const entry = result.entry;
    if (!entry) {
      continue;
    }
    if (result.updatedShard) {
      index.shards[shard] = result.updatedShard;
      indexDirty = true;
    }
    const matchingPartitions = entry.partitions.filter((partition) =>
      partitionOverlapsRange(partition, rangeStart, rangeEnd) &&
      matchesPartitionFilters(partition.partitionKey ?? {}, filters)
    );

    if (matchingPartitions.length === 0) {
      continue;
    }

    visitedShards.push(shard);
    const manifestRecord = toManifestRecord(entry);
    manifests.push(manifestRecord);
    partitions.push(
      ...matchingPartitions.map((partition) => toPartitionWithTarget(partition))
    );
  }

  if (indexDirty) {
    await writeIndex(options, dataset.slug, index);
  }

  if (manifests.length === 0 || partitions.length === 0) {
    recordMiss('stale');
    return fallbackQuery(dataset, rangeStart, rangeEnd, filters);
  }

  return {
    manifests,
    partitions,
    shards: visitedShards,
    cacheUsed: true
  } satisfies CacheLoadResult;
}

async function fallbackQuery(
  dataset: DatasetRecord,
  rangeStart: Date,
  rangeEnd: Date,
  filters: PartitionFilters
): Promise<CacheLoadResult> {
  const manifests = await listPublishedManifestsForRange(dataset.id, rangeStart, rangeEnd);
  const shards = Array.from(new Set(manifests.map((manifest) => manifest.manifestShard)));
  const partitions = await listPartitionsForQuery(dataset.id, rangeStart, rangeEnd, filters, {
    shards
  });
  return {
    manifests,
    partitions,
    shards,
    cacheUsed: false
  } satisfies CacheLoadResult;
}

export async function refreshManifestCache(
  dataset: Pick<DatasetRecord, 'id' | 'slug'>,
  manifest: DatasetManifestRecord,
  partitionsWithTargets?: PartitionWithTarget[]
): Promise<void> {
  const options = loadOptions();
  if (!options.enabled) {
    return;
  }
  const index = await ensureIndex(options, dataset);
  const shard = manifest.manifestShard;
  const previousEntry = index.shards[shard];
  if (previousEntry && previousEntry.manifestVersion !== manifest.version) {
    await deleteEntry(options, previousEntry.key);
    recordEviction('rebuild');
  }
  const { cacheKey, cachedAt } = await storeManifestEntry(options, dataset, manifest, partitionsWithTargets);
  index.shards[shard] = {
    key: cacheKey,
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    updatedAt: manifest.updatedAt,
    cachedAt
  } satisfies ManifestIndexShardEntry;
  await writeIndex(options, dataset.slug, index);
}

export async function invalidateManifestShard(
  dataset: Pick<DatasetRecord, 'id' | 'slug'>,
  shard: string
): Promise<void> {
  const options = loadOptions();
  if (!options.enabled) {
    return;
  }
  const index = await readIndex(options, dataset.slug);
  if (!index) {
    return;
  }
  const shardEntry = index.shards[shard];
  if (!shardEntry) {
    return;
  }
  await deleteEntry(options, shardEntry.key);
  recordEviction('invalidate');
  delete index.shards[shard];
  await writeIndex(options, dataset.slug, index);
}

export async function invalidateManifestCache(datasetSlug: string): Promise<void> {
  const options = loadOptions();
  if (!options.enabled) {
    return;
  }
  const index = await readIndex(options, datasetSlug);
  if (!index) {
    return;
  }
  for (const shardEntry of Object.values(index.shards)) {
    await deleteEntry(options, shardEntry.key);
  }
  await deleteIndex(options, datasetSlug);
}

export async function shutdownManifestCache(): Promise<void> {
  entryCache.clear();
  indexCache.clear();
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (err) {
      console.warn('[timestore:manifest-cache] failed to close redis connection', err);
    }
    redisClient = null;
  }
}

export function __resetManifestCacheForTests(): void {
  entryCache.clear();
  indexCache.clear();
  if (redisClient) {
    void redisClient.quit();
    redisClient = null;
  }
}
