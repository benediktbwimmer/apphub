import { exit } from 'node:process';
import { loadServiceConfig } from '../config/serviceConfig';
import { closePool } from '../db/client';
import {
  listActiveDatasets,
  listPublishedManifests,
  getPartitionsWithTargetsForManifest,
  type DatasetManifestRecord
} from '../db/metadata';
import { refreshManifestCache, shutdownManifestCache } from '../cache/manifestCache';

async function main(): Promise<void> {
  const config = loadServiceConfig();
  if (!config.query.manifestCache.enabled) {
    console.log('[manifest-cache] cache disabled; skipping prime request');
    return;
  }

  const datasets = await listActiveDatasets();
  if (datasets.length === 0) {
    console.log('[manifest-cache] no active datasets found');
    return;
  }

  console.log(`[manifest-cache] priming cache for ${datasets.length} dataset(s)`);

  for (const dataset of datasets) {
    const manifests = await listPublishedManifests(dataset.id);
    if (manifests.length === 0) {
      continue;
    }

    const latestByShard = new Map<string, DatasetManifestRecord>();
    for (const manifest of manifests) {
      if (!latestByShard.has(manifest.manifestShard)) {
        latestByShard.set(manifest.manifestShard, manifest);
      }
    }

    let primed = 0;
    for (const manifest of latestByShard.values()) {
      try {
        const partitions = await getPartitionsWithTargetsForManifest(manifest.id);
        const manifestRecord = { ...manifest };
        await refreshManifestCache({ id: dataset.id, slug: dataset.slug }, manifestRecord, partitions);
        primed += 1;
      } catch (err) {
        console.warn(
          '[manifest-cache] failed to prime manifest',
          {
            datasetId: dataset.id,
            datasetSlug: dataset.slug,
            manifestId: manifest.id,
            error: err instanceof Error ? err.message : String(err)
          }
        );
      }
    }

    console.log(
      `[manifest-cache] dataset ${dataset.slug} => primed ${primed} shard(s)`
    );
  }
}

main()
  .catch((err) => {
    console.error('[manifest-cache] prime failed', err);
    exit(1);
  })
  .finally(async () => {
    await shutdownManifestCache().catch((err) => {
      console.warn('[manifest-cache] failed to shutdown cache during exit', err);
    });
    await closePool().catch((err) => {
      console.warn('[manifest-cache] failed to close postgres pool during exit', err);
    });
  });
