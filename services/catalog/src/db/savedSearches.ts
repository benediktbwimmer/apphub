import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  type SavedCatalogSearchCreateInput,
  type SavedCatalogSearchRecord,
  type SavedCatalogSearchUpdateInput,
  type IngestStatus,
  type RepositorySort
} from './types';
import { mapSavedCatalogSearchRow } from './rowMappers';
import type { SavedCatalogSearchRow } from './rowTypes';

const DEFAULT_VISIBILITY = 'private' as const;
const DEFAULT_SORT: RepositorySort = 'relevance';

const ALLOWED_STATUSES: readonly IngestStatus[] = ['seed', 'pending', 'processing', 'ready', 'failed'];
const ALLOWED_SORTS: readonly RepositorySort[] = ['relevance', 'updated', 'name'];

export type SavedCatalogSearchOwner = {
  key: string;
  userId: string | null;
  subject: string;
  kind: 'user' | 'service';
  tokenHash: string | null;
};

function normalizeName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled search';
}

function normalizeDescription(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeSearchInput(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function normalizeStatusFiltersInput(filters: IngestStatus[] | undefined): IngestStatus[] {
  if (!filters || filters.length === 0) {
    return [];
  }
  const seen = new Set<IngestStatus>();
  for (const filter of filters) {
    if ((ALLOWED_STATUSES as readonly string[]).includes(filter)) {
      seen.add(filter);
    }
  }
  return Array.from(seen);
}

function normalizeSortInput(sort: RepositorySort | undefined): RepositorySort {
  if (!sort) {
    return DEFAULT_SORT;
  }
  return (ALLOWED_SORTS as readonly string[]).includes(sort) ? sort : DEFAULT_SORT;
}

function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return base.length > 0 ? base : 'search';
}

async function slugExists(client: PoolClient, slug: string): Promise<boolean> {
  const { rows } = await client.query('SELECT 1 FROM saved_catalog_searches WHERE slug = $1 LIMIT 1', [slug]);
  return rows.length > 0;
}

async function generateUniqueSlug(client: PoolClient, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let attempts = 0;

  while (await slugExists(client, candidate)) {
    attempts += 1;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 6);
    candidate = `${base}-${suffix}`.slice(0, 80);
    if (attempts > 8) {
      candidate = `${base}-${randomUUID()}`.slice(0, 80);
      break;
    }
  }

  return candidate;
}

function mapRow(row: SavedCatalogSearchRow): SavedCatalogSearchRecord {
  return mapSavedCatalogSearchRow(row);
}

async function fetchBySlug(
  client: PoolClient,
  ownerKey: string,
  slug: string
): Promise<SavedCatalogSearchRecord | null> {
  const { rows } = await client.query<SavedCatalogSearchRow>(
    'SELECT * FROM saved_catalog_searches WHERE slug = $1 AND owner_key = $2',
    [slug, ownerKey]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listSavedCatalogSearches(owner: SavedCatalogSearchOwner): Promise<SavedCatalogSearchRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<SavedCatalogSearchRow>(
      'SELECT * FROM saved_catalog_searches WHERE owner_key = $1 ORDER BY name ASC',
      [owner.key]
    );
    return rows.map(mapRow);
  });
}

export async function getSavedCatalogSearchBySlug(
  owner: SavedCatalogSearchOwner,
  slug: string
): Promise<SavedCatalogSearchRecord | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return useConnection((client) => fetchBySlug(client, owner.key, normalized));
}

export async function createSavedCatalogSearch(
  owner: SavedCatalogSearchOwner,
  input: SavedCatalogSearchCreateInput
): Promise<SavedCatalogSearchRecord> {
  const name = normalizeName(input.name);
  const searchInput = normalizeSearchInput(input.searchInput);
  const statusFilters = normalizeStatusFiltersInput(input.statusFilters);
  const sort = normalizeSortInput(input.sort);
  const description = normalizeDescription(input.description ?? null);

  return useTransaction(async (client) => {
    const slug = await generateUniqueSlug(client, name);
    const id = randomUUID();

    const { rows } = await client.query<SavedCatalogSearchRow>(
      `INSERT INTO saved_catalog_searches (
         id,
         slug,
         owner_key,
         owner_user_id,
         owner_subject,
         owner_kind,
         owner_token_hash,
         name,
         description,
         search_input,
         status_filters,
         sort,
         visibility
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       )
       RETURNING *`,
      [
        id,
        slug,
        owner.key,
        owner.userId,
        owner.subject,
        owner.kind,
        owner.tokenHash,
        name,
        description,
        searchInput,
        statusFilters,
        sort,
        DEFAULT_VISIBILITY
      ]
    );

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create saved catalog search');
    }

    return mapRow(row);
  });
}

export async function updateSavedCatalogSearch(
  owner: SavedCatalogSearchOwner,
  slug: string,
  patch: SavedCatalogSearchUpdateInput
): Promise<SavedCatalogSearchRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  return useTransaction(async (client) => {
    const existing = await fetchBySlug(client, owner.key, normalizedSlug);
    if (!existing) {
      return null;
    }

    const nextName = patch.name !== undefined ? normalizeName(patch.name) : existing.name;
    const nextDescription =
      patch.description !== undefined ? normalizeDescription(patch.description) : existing.description;
    const nextSearchInput =
      patch.searchInput !== undefined ? normalizeSearchInput(patch.searchInput) : existing.searchInput;
    const nextStatusFilters =
      patch.statusFilters !== undefined ? normalizeStatusFiltersInput(patch.statusFilters) : existing.statusFilters;
    const nextSort = patch.sort !== undefined ? normalizeSortInput(patch.sort) : existing.sort;

    const unchanged =
      nextName === existing.name &&
      nextDescription === existing.description &&
      nextSearchInput === existing.searchInput &&
      nextSort === existing.sort &&
      nextStatusFilters.length === existing.statusFilters.length &&
      nextStatusFilters.every((value, index) => value === existing.statusFilters[index]);

    if (unchanged) {
      return existing;
    }

    const { rows } = await client.query<SavedCatalogSearchRow>(
      `UPDATE saved_catalog_searches
         SET name = $1,
             description = $2,
             search_input = $3,
             status_filters = $4,
             sort = $5,
             updated_at = NOW()
       WHERE slug = $6
         AND owner_key = $7
       RETURNING *`,
      [
        nextName,
        nextDescription,
        nextSearchInput,
        nextStatusFilters,
        nextSort,
        normalizedSlug,
        owner.key
      ]
    );

    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}

export async function deleteSavedCatalogSearch(
  owner: SavedCatalogSearchOwner,
  slug: string
): Promise<boolean> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return useConnection(async (client) => {
    const result = await client.query(
      'DELETE FROM saved_catalog_searches WHERE slug = $1 AND owner_key = $2',
      [normalized, owner.key]
    );
    return (result.rowCount ?? 0) > 0;
  });
}

export async function recordSavedCatalogSearchApplied(
  owner: SavedCatalogSearchOwner,
  slug: string
): Promise<SavedCatalogSearchRecord | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return useTransaction(async (client) => {
    const { rows } = await client.query<SavedCatalogSearchRow>(
      `UPDATE saved_catalog_searches
         SET applied_count = applied_count + 1,
             last_applied_at = NOW(),
             updated_at = NOW()
       WHERE slug = $1
         AND owner_key = $2
       RETURNING *`,
      [normalized, owner.key]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}

export async function recordSavedCatalogSearchShared(
  owner: SavedCatalogSearchOwner,
  slug: string
): Promise<SavedCatalogSearchRecord | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return useTransaction(async (client) => {
    const { rows } = await client.query<SavedCatalogSearchRow>(
      `UPDATE saved_catalog_searches
         SET shared_count = shared_count + 1,
             last_shared_at = NOW(),
             updated_at = NOW()
       WHERE slug = $1
         AND owner_key = $2
       RETURNING *`,
      [normalized, owner.key]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}
