import type { RecordAuditView } from '../db/auditRepository';

export type PathValue = {
  path: string;
  value: unknown;
};

export type PathChange = {
  path: string;
  before: unknown;
  after: unknown;
};

export type MetadataDiff = {
  added: PathValue[];
  removed: PathValue[];
  changed: PathChange[];
};

export type TagsDiff = {
  added: string[];
  removed: string[];
};

export type ScalarDiff<T> = {
  before: T | null;
  after: T | null;
  changed: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function appendPath(base: string, segment: string, isIndex = false): string {
  if (!base) {
    return isIndex ? `[${segment}]` : segment;
  }
  return isIndex ? `${base}[${segment}]` : `${base}.${segment}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (!valuesEqual(a[key], b[key])) {
        return false;
      }
    }
    return true;
  }

  if (isArray(a) && isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let index = 0; index < a.length; index += 1) {
      if (!valuesEqual(a[index], b[index])) {
        return false;
      }
    }
    return true;
  }

  return false;
}

function walkDiff(
  current: unknown,
  previous: unknown,
  path: string,
  result: MetadataDiff
): void {
  if (valuesEqual(current, previous)) {
    return;
  }

  if (isPlainObject(current) && isPlainObject(previous)) {
    const keys = new Set([...Object.keys(current), ...Object.keys(previous)]);
    for (const key of Array.from(keys).sort()) {
      const nextPath = appendPath(path, key);
      const nextCurrent = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined;
      const nextPrevious = Object.prototype.hasOwnProperty.call(previous, key) ? previous[key] : undefined;
      if (nextCurrent === undefined) {
        result.removed.push({ path: nextPath, value: nextPrevious });
        continue;
      }
      if (nextPrevious === undefined) {
        result.added.push({ path: nextPath, value: nextCurrent });
        continue;
      }
      walkDiff(nextCurrent, nextPrevious, nextPath, result);
    }
    return;
  }

  if (isArray(current) && isArray(previous)) {
    const maxLength = Math.max(current.length, previous.length);
    for (let index = 0; index < maxLength; index += 1) {
      const nextPath = appendPath(path, String(index), true);
      const nextCurrent = index < current.length ? current[index] : undefined;
      const nextPrevious = index < previous.length ? previous[index] : undefined;
      if (nextCurrent === undefined) {
        result.removed.push({ path: nextPath, value: nextPrevious });
        continue;
      }
      if (nextPrevious === undefined) {
        result.added.push({ path: nextPath, value: nextCurrent });
        continue;
      }
      walkDiff(nextCurrent, nextPrevious, nextPath, result);
    }
    return;
  }

  result.changed.push({ path, before: previous, after: current });
}

export function computeMetadataDiff(
  current: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null | undefined
): MetadataDiff {
  const normalizedCurrent = current && isPlainObject(current) ? current : {};
  const normalizedPrevious = previous && isPlainObject(previous) ? previous : {};

  const result: MetadataDiff = {
    added: [],
    removed: [],
    changed: []
  };

  walkDiff(normalizedCurrent, normalizedPrevious, '', result);

  result.added.sort((a, b) => a.path.localeCompare(b.path));
  result.removed.sort((a, b) => a.path.localeCompare(b.path));
  result.changed.sort((a, b) => a.path.localeCompare(b.path));

  return result;
}

export function computeTagsDiff(current?: string[] | null, previous?: string[] | null): TagsDiff {
  const currentSet = new Set((current ?? []).map((tag) => tag.trim()).filter(Boolean));
  const previousSet = new Set((previous ?? []).map((tag) => tag.trim()).filter(Boolean));

  const added: string[] = [];
  const removed: string[] = [];

  for (const tag of currentSet) {
    if (!previousSet.has(tag)) {
      added.push(tag);
    }
  }

  for (const tag of previousSet) {
    if (!currentSet.has(tag)) {
      removed.push(tag);
    }
  }

  added.sort();
  removed.sort();

  return { added, removed };
}

export function computeScalarDiff<T>(after: T | null | undefined, before: T | null | undefined): ScalarDiff<T> {
  const normalizedAfter = (after ?? null) as T | null;
  const normalizedBefore = (before ?? null) as T | null;
  return {
    before: normalizedBefore,
    after: normalizedAfter,
    changed: normalizedAfter !== normalizedBefore
  } satisfies ScalarDiff<T>;
}

export type AuditDiff = {
  audit: {
    id: number;
    namespace: string;
    key: string;
    action: string;
    actor: string | null;
    previousVersion: number | null;
    version: number | null;
    createdAt: string;
  };
  metadata: MetadataDiff;
  tags: TagsDiff;
  owner: ScalarDiff<string>;
  schemaHash: ScalarDiff<string>;
  snapshots: {
    current: {
      metadata: Record<string, unknown> | null;
      tags: string[];
      owner: string | null;
      schemaHash: string | null;
    };
    previous: {
      metadata: Record<string, unknown> | null;
      tags: string[];
      owner: string | null;
      schemaHash: string | null;
    };
  };
};

export function buildAuditDiff(entry: RecordAuditView): AuditDiff {
  return {
    audit: {
      id: entry.id,
      namespace: entry.namespace,
      key: entry.recordKey,
      action: entry.action,
      actor: entry.actor,
      previousVersion: entry.previousVersion,
      version: entry.version,
      createdAt: entry.createdAt.toISOString()
    },
    metadata: computeMetadataDiff(entry.metadata, entry.previousMetadata),
    tags: computeTagsDiff(entry.tags, entry.previousTags),
    owner: computeScalarDiff(entry.owner, entry.previousOwner),
    schemaHash: computeScalarDiff(entry.schemaHash, entry.previousSchemaHash),
    snapshots: {
      current: {
        metadata: entry.metadata,
        tags: entry.tags ?? [],
        owner: entry.owner ?? null,
        schemaHash: entry.schemaHash ?? null
      },
      previous: {
        metadata: entry.previousMetadata,
        tags: entry.previousTags ?? [],
        owner: entry.previousOwner ?? null,
        schemaHash: entry.previousSchemaHash ?? null
      }
    }
  } satisfies AuditDiff;
}
