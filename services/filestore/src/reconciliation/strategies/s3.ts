import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type HeadObjectCommandOutput,
  type ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import type { PoolClient } from 'pg';
import type { BackendMountRecord } from '../../db/backendMounts';
import {
  getNodeById,
  getNodeByPath,
  insertNode,
  updateNodeState,
  type ConsistencyState,
  type NodeRecord
} from '../../db/nodes';
import { recordSnapshot } from '../../db/snapshots';
import { FilestoreError } from '../../errors';
import {
  applyRollupPlanWithinTransaction,
  collectAncestorChain,
  computeContribution
} from '../../rollup/manager';
import { createEmptyRollupPlan } from '../../rollup/types';
import { getParentPath, normalizePath } from '../../utils/path';
import type {
  ChildReconciliationJobRequest,
  ReconciliationJobPayload,
  ReconciliationJobSummary
} from '../types';

const defaultClients = new Map<number, S3Client>();

type TestStoreRegistry = Map<number, Map<string, string>>;

function getTestStoreRegistry(): TestStoreRegistry | null {
  const globalWithStores = globalThis as { __filestoreTestS3Stores?: TestStoreRegistry };
  return globalWithStores.__filestoreTestS3Stores ?? null;
}

function resolveTestStoreClient(backend: S3Backend): S3Client | null {
  const registry = getTestStoreRegistry();
  if (!registry) {
    return null;
  }
  const storeId = (backend.config?.__testStoreId as number | undefined) ?? null;
  if (storeId === null) {
    return null;
  }
  const store = registry.get(storeId);
  if (!store) {
    return null;
  }

  const client = {
    async send(command: unknown): Promise<unknown> {
      if (command instanceof HeadObjectCommand) {
        const key = command.input.Key;
        if (!key) {
          throw new Error('Key is required');
        }
        if (!store.has(key)) {
          const notFound = new Error('Object not found');
          (notFound as any).$metadata = { httpStatusCode: 404 };
          throw notFound;
        }
        const body = store.get(key) ?? '';
        return {
          ContentLength: Buffer.byteLength(body),
          ETag: body || undefined,
          LastModified: new Date(),
          $metadata: { httpStatusCode: 200 }
        } satisfies HeadObjectCommandOutput;
      }

      if (command instanceof ListObjectsV2Command) {
        const prefix = command.input.Prefix ?? '';
        const keys = Array.from(store.keys()).filter((key) => key.startsWith(prefix));
        const slice = keys.slice(0, command.input.MaxKeys ?? 1000);
        return {
          Contents: slice.map((key) => ({
            Key: key,
            ETag: store.get(key) ?? undefined,
            LastModified: new Date()
          })),
          KeyCount: slice.length,
          IsTruncated: slice.length < keys.length,
          NextContinuationToken: undefined,
          $metadata: { httpStatusCode: 200 }
        } satisfies ListObjectsV2CommandOutput;
      }

      throw new Error(`Unsupported command in test S3 client: ${command?.constructor?.name ?? 'unknown'}`);
    }
  } as unknown as S3Client;

  return client;
}

type AppliedPlan = Awaited<ReturnType<typeof applyRollupPlanWithinTransaction>>;

type S3ObjectProbe = {
  exists: boolean;
  isDirectory: boolean;
  sizeBytes: number;
  eTag: string | null;
  lastModified: Date | null;
};

type S3Backend = BackendMountRecord & { backendKind: 's3'; bucket: string };

type Contribution = ReturnType<typeof computeContribution>;

function ensureS3Backend(backend: BackendMountRecord): asserts backend is S3Backend {
  if (backend.backendKind !== 's3') {
    throw new FilestoreError('Expected S3 backend for reconciliation strategy', 'BACKEND_NOT_FOUND');
  }
  if (!backend.bucket) {
    throw new FilestoreError('S3 backend missing bucket', 'BACKEND_NOT_FOUND', { backendId: backend.id });
  }
}

function normalizePrefix(prefix: string | null): string {
  if (!prefix) {
    return '';
  }
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildKey(backend: S3Backend, relativePath: string): string {
  const prefix = normalizePrefix(backend.prefix ?? null);
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!prefix) {
    return cleaned;
  }
  if (!cleaned) {
    return prefix;
  }
  return `${prefix}/${cleaned}`;
}

function resolveClient(backend: S3Backend): S3Client {
  const testClient = resolveTestStoreClient(backend);
  if (testClient) {
    return testClient;
  }
  const existing = defaultClients.get(backend.id);
  if (existing) {
    return existing;
  }

  const region = (backend.config?.region as string | undefined) ?? process.env.FILESTORE_S3_REGION ?? 'us-east-1';
  const endpoint = backend.config?.endpoint as string | undefined;
  const forcePathStyle = (backend.config?.forcePathStyle as boolean | undefined) ?? true;
  const accessKeyId = (backend.config?.accessKeyId as string | undefined) ?? process.env.FILESTORE_S3_ACCESS_KEY_ID;
  const secretAccessKey =
    (backend.config?.secretAccessKey as string | undefined) ?? process.env.FILESTORE_S3_SECRET_ACCESS_KEY;
  const sessionToken = (backend.config?.sessionToken as string | undefined) ?? process.env.FILESTORE_S3_SESSION_TOKEN;

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            sessionToken: sessionToken ?? undefined
          }
        : undefined
  });
  defaultClients.set(backend.id, client);
  return client;
}

async function probeS3Path(
  client: S3Client,
  backend: S3Backend,
  relativePath: string
): Promise<S3ObjectProbe> {
  const key = buildKey(backend, relativePath);
  const directoryKey = key ? `${key.replace(/\/+$/, '')}/` : '';

  const result: S3ObjectProbe = {
    exists: false,
    isDirectory: false,
    sizeBytes: 0,
    eTag: null,
    lastModified: null
  };

  if (!key) {
    return result;
  }

  try {
    const head = (await client.send(
      new HeadObjectCommand({
        Bucket: backend.bucket,
        Key: key
      })
    )) as HeadObjectCommandOutput;
    result.exists = true;
    result.isDirectory = false;
    result.sizeBytes = Number(head.ContentLength ?? 0);
    result.eTag = head.ETag ?? null;
    result.lastModified = head.LastModified ?? null;
    return result;
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status && status !== 404) {
      throw err;
    }
  }

  if (!directoryKey) {
    return result;
  }

  const listing = (await client.send(
    new ListObjectsV2Command({
      Bucket: backend.bucket,
      Prefix: directoryKey,
      MaxKeys: 1
    })
  )) as ListObjectsV2CommandOutput;

  if ((listing.Contents ?? []).length > 0) {
    const [first] = listing.Contents as Required<ListObjectsV2CommandOutput>['Contents'];
    result.exists = true;
    result.isDirectory = true;
    result.sizeBytes = 0;
    result.eTag = first?.ETag ?? null;
    result.lastModified = first?.LastModified ?? null;
  }

  return result;
}

function diffContribution(before: Contribution, after: Contribution) {
  return {
    sizeBytesDelta: after.sizeBytes - before.sizeBytes,
    fileCountDelta: after.fileCount - before.fileCount,
    directoryCountDelta: after.directoryCount - before.directoryCount,
    childCountDelta: (after.active ? 1 : 0) - (before.active ? 1 : 0)
  };
}

async function collectS3ChildJobs(
  client: S3Client,
  backend: S3Backend,
  normalizedPath: string,
  options: { requestedHash: boolean }
): Promise<ChildReconciliationJobRequest[]> {
  const baseKey = buildKey(backend, normalizedPath);
  if (!baseKey) {
    return [];
  }
  const prefix = `${baseKey.replace(/\/+$/, '')}/`;
  const children: ChildReconciliationJobRequest[] = [];
  let continuationToken: string | undefined;

  do {
    const response = (await client.send(
      new ListObjectsV2Command({
        Bucket: backend.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken
      })
    )) as ListObjectsV2CommandOutput;

    for (const entry of response.Contents ?? []) {
      const key = entry.Key ?? '';
      if (!key || key === prefix) {
        continue;
      }
      const remainder = key.slice(prefix.length);
      if (!remainder || remainder.includes('/')) {
        continue;
      }
      const childPath = normalizedPath ? `${normalizedPath}/${remainder}` : remainder;
      const normalizedChild = normalizePath(childPath);
      children.push({
        path: normalizedChild,
        nodeId: null,
        detectChildren: false,
        requestedHash: options.requestedHash
      });
    }

    for (const entry of response.CommonPrefixes ?? []) {
      const key = entry.Prefix ?? '';
      if (!key.startsWith(prefix)) {
        continue;
      }
      const remainder = key.slice(prefix.length).replace(/\/+$/, '');
      if (!remainder) {
        continue;
      }
      const childPath = normalizedPath ? `${normalizedPath}/${remainder}` : remainder;
      const normalizedChild = normalizePath(childPath);
      children.push({
        path: normalizedChild,
        nodeId: null,
        detectChildren: true,
        requestedHash: options.requestedHash
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken ?? undefined : undefined;
  } while (continuationToken);

  return children;
}

async function buildAncestorPlan(
  client: PoolClient,
  node: NodeRecord,
  contributionDiff: ReturnType<typeof diffContribution>,
  plan: ReturnType<typeof createEmptyRollupPlan>
): Promise<void> {
  if (!node.parentId) {
    return;
  }
  const parent = await getNodeById(client, node.parentId, { forUpdate: true });
  if (!parent) {
    return;
  }
  const ancestors = await collectAncestorChain(client, parent);
  ancestors.forEach((ancestor, index) => {
    const childCountDelta = index === 0 ? contributionDiff.childCountDelta : 0;
    if (
      contributionDiff.sizeBytesDelta !== 0 ||
      contributionDiff.fileCountDelta !== 0 ||
      contributionDiff.directoryCountDelta !== 0 ||
      childCountDelta !== 0
    ) {
      plan.increments.push({
        nodeId: ancestor.id,
        sizeBytesDelta: contributionDiff.sizeBytesDelta,
        fileCountDelta: contributionDiff.fileCountDelta,
        directoryCountDelta: contributionDiff.directoryCountDelta,
        childCountDelta,
        markPending: false
      });
      plan.touchedNodeIds.push(ancestor.id);
      if (index === 0) {
        plan.scheduleCandidates.push({
          nodeId: ancestor.id,
          backendMountId: ancestor.backendMountId,
          reason: 'mutation',
          depth: ancestor.depth,
          childCountDelta
        });
      }
    }
  });
}

export async function reconcileS3(
  client: PoolClient,
  backend: BackendMountRecord,
  job: ReconciliationJobPayload
): Promise<ReconciliationJobSummary> {
  ensureS3Backend(backend);
  const normalizedPath = job.path.trim();
  if (!normalizedPath) {
    return { outcome: 'skipped', reason: job.reason };
  }

  const node = job.nodeId
    ? await getNodeById(client, job.nodeId, { forUpdate: true })
    : await getNodeByPath(client, backend.id, normalizedPath, { forUpdate: true });

  const clientInstance = resolveClient(backend);
  const probe = await probeS3Path(clientInstance, backend, normalizedPath);
  const plan = createEmptyRollupPlan();
  const now = new Date();
  const requestedHash = Boolean(job.requestedHash);

  if (!probe.exists) {
    if (!node) {
      return { outcome: 'skipped', reason: job.reason };
    }

    const beforeContribution = computeContribution(node);
    const updated = await updateNodeState(client, node.id, 'missing', {
      sizeBytes: node.sizeBytes,
      metadata: node.metadata,
      lastModifiedAt: node.lastModifiedAt,
      consistencyState: 'missing',
      consistencyCheckedAt: now,
      lastReconciledAt: node.lastReconciledAt ?? null
    });
    await recordSnapshot(client, updated);

    plan.touchedNodeIds.push(updated.id);
    plan.invalidate.push({ nodeId: updated.id, state: 'invalid' });
    const afterContribution = computeContribution(updated);
    const contributionDiff = diffContribution(beforeContribution, afterContribution);
    await buildAncestorPlan(client, updated, contributionDiff, plan);
    let appliedPlan: AppliedPlan | null = null;
    if (
      plan.ensure.length > 0 ||
      plan.increments.length > 0 ||
      plan.invalidate.length > 0 ||
      plan.touchedNodeIds.length > 0
    ) {
      appliedPlan = await applyRollupPlanWithinTransaction(client, plan);
    }

    return {
      outcome: 'missing',
      reason: job.reason,
      node: updated,
      previousNode: node,
      plan,
      appliedPlan,
      emittedEvent: {
        type: 'filestore.node.missing',
        node: updated,
        previousState: node.state
      }
    } satisfies ReconciliationJobSummary;
  }

  const metadata: Record<string, unknown> = {
    ...(node?.metadata ?? {}),
    eTag: probe.eTag
  };
  const sizeBytes = probe.isDirectory ? 0 : probe.sizeBytes;
  const kind: NodeRecord['kind'] = probe.isDirectory ? 'directory' : 'file';
  const consistencyState: ConsistencyState = 'active';
  const shouldDiscoverChildren = Boolean(job.detectChildren) && probe.isDirectory;

  if (!node) {
    const parentPath = getParentPath(normalizedPath);
    let parentId: number | null = null;
    if (parentPath) {
      const parent = await getNodeByPath(client, backend.id, parentPath, { forUpdate: true });
      if (!parent) {
        throw new FilestoreError('Parent directory not tracked for reconciled S3 node', 'PARENT_NOT_FOUND', {
          backendMountId: backend.id,
          path: parentPath
        });
      }
      parentId = parent.id;
    }

    const inserted = await insertNode(client, {
      backendMountId: backend.id,
      parentId,
      path: normalizedPath,
      kind,
      sizeBytes,
      metadata,
      lastModifiedAt: probe.lastModified ?? now,
      state: 'active',
      consistencyState,
      consistencyCheckedAt: now,
      lastReconciledAt: now
    });
    await recordSnapshot(client, inserted);

    plan.ensure.push(inserted.id);
    plan.touchedNodeIds.push(inserted.id);
    const beforeContribution = computeContribution(null);
    const afterContribution = computeContribution(inserted);
    const contributionDiff = diffContribution(beforeContribution, afterContribution);
    await buildAncestorPlan(client, inserted, contributionDiff, plan);
    let appliedPlan: AppliedPlan | null = null;
    if (
      plan.ensure.length > 0 ||
      plan.increments.length > 0 ||
      plan.invalidate.length > 0 ||
      plan.touchedNodeIds.length > 0
    ) {
      appliedPlan = await applyRollupPlanWithinTransaction(client, plan);
    }

    const childJobs = shouldDiscoverChildren
      ? await collectS3ChildJobs(clientInstance, backend, normalizedPath, { requestedHash })
      : [];

    return {
      outcome: 'reconciled',
      reason: job.reason,
      node: inserted,
      previousNode: null,
      plan,
      appliedPlan,
      emittedEvent: {
        type: 'filestore.node.reconciled',
        node: inserted
      },
      childJobs
    } satisfies ReconciliationJobSummary;
  }

  const previousContribution = computeContribution(node);
  const updated = await updateNodeState(client, node.id, 'active', {
    sizeBytes,
    metadata,
    lastModifiedAt: probe.lastModified ?? now,
    consistencyState,
    consistencyCheckedAt: now,
    lastReconciledAt: now
  });
  await recordSnapshot(client, updated);

  plan.ensure.push(updated.id);
  plan.touchedNodeIds.push(updated.id);
  const afterContribution = computeContribution(updated);
  const contributionDiff = diffContribution(previousContribution, afterContribution);
  await buildAncestorPlan(client, updated, contributionDiff, plan);
  let appliedPlan: AppliedPlan | null = null;
  if (
    plan.ensure.length > 0 ||
    plan.increments.length > 0 ||
    plan.invalidate.length > 0 ||
    plan.touchedNodeIds.length > 0
  ) {
    appliedPlan = await applyRollupPlanWithinTransaction(client, plan);
  }

  const childJobs = shouldDiscoverChildren
    ? await collectS3ChildJobs(clientInstance, backend, normalizedPath, { requestedHash })
    : [];

  return {
    outcome: 'reconciled',
    reason: job.reason,
    node: updated,
    previousNode: node,
    plan,
    appliedPlan,
    emittedEvent: {
      type: 'filestore.node.reconciled',
      node: updated
    },
    childJobs
  } satisfies ReconciliationJobSummary;
}
