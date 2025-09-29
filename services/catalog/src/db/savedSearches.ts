import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  type JsonValue,
  type SavedSearchCreateInput,
  type SavedSearchRecord,
  type SavedSearchUpdateInput
} from './types';
export type { SavedSearchCreateInput, SavedSearchRecord, SavedSearchUpdateInput } from './types';
import { mapSavedSearchRow } from './rowMappers';
import type { SavedCatalogSearchRow } from './rowTypes';

const DEFAULT_VISIBILITY = 'private' as const;
const DEFAULT_SORT = 'relevance';
const DEFAULT_CATEGORY = 'catalog';

export type SavedSearchOwner = {
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

function normalizeSearchInput(value: string | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : '';
}

function normalizeStatusFiltersInput(filters: string[] | undefined): string[] {
  if (!filters || filters.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  for (const filter of filters) {
    if (typeof filter !== 'string') {
      continue;
    }
    const normalized = filter.trim();
    if (!normalized) {
      continue;
    }
    seen.add(normalized.toLowerCase());
  }
  return Array.from(seen);
}

function normalizeSortInput(sort: string | undefined): string {
  if (typeof sort !== 'string') {
    return DEFAULT_SORT;
  }
  const trimmed = sort.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 100) : DEFAULT_SORT;
}

function normalizeCategory(value: string | undefined): string {
  if (typeof value !== 'string') {
    return DEFAULT_CATEGORY;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_CATEGORY;
  }
  return trimmed.slice(0, 100).toLowerCase();
}

function normalizeConfig(value: JsonValue | undefined): JsonValue {
  if (value === undefined || value === null) {
    return {};
  }
  return value;
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

function mapRow(row: SavedCatalogSearchRow): SavedSearchRecord {
  return mapSavedSearchRow(row);
}

async function fetchBySlug(
  client: PoolClient,
  ownerKey: string,
  slug: string
): Promise<SavedSearchRecord | null> {
  const { rows } = await client.query<SavedCatalogSearchRow>(
    'SELECT * FROM saved_catalog_searches WHERE slug = $1 AND owner_key = $2',
    [slug, ownerKey]
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listSavedSearches(
  owner: SavedSearchOwner,
  options: { category?: string | null } = {}
): Promise<SavedSearchRecord[]> {
  const categoryFilter = options.category ? normalizeCategory(options.category) : null;

  return useConnection(async (client) => {
    const params: unknown[] = [owner.key];
    let whereClause = 'owner_key = $1';

    if (categoryFilter) {
      params.push(categoryFilter);
      whereClause += ` AND category = $${params.length}`;
    }

    const { rows } = await client.query<SavedCatalogSearchRow>(
      `SELECT *
       FROM saved_catalog_searches
       WHERE ${whereClause}
       ORDER BY name ASC`,
      params
    );
    return rows.map(mapRow);
  });
}

export async function getSavedSearchBySlug(
  owner: SavedSearchOwner,
  slug: string
): Promise<SavedSearchRecord | null> {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return useConnection((client) => fetchBySlug(client, owner.key, normalized));
}

export async function createSavedSearch(
  owner: SavedSearchOwner,
  input: SavedSearchCreateInput
): Promise<SavedSearchRecord> {
  const name = normalizeName(input.name);
  const description = normalizeDescription(input.description ?? null);
  const searchInput = normalizeSearchInput(input.searchInput);
  const statusFilters = normalizeStatusFiltersInput(input.statusFilters);
  const sort = normalizeSortInput(input.sort);
  const category = normalizeCategory(input.category);
  const config = normalizeConfig(input.config as JsonValue | undefined);

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
         category,
         config,
         visibility
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
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
        category,
        config,
        DEFAULT_VISIBILITY
      ]
    );

    const row = rows[0];
    if (!row) {
      throw new Error('Failed to create saved search');
    }

    return mapRow(row);
  });
}

export async function updateSavedSearch(
  owner: SavedSearchOwner,
  slug: string,
  patch: SavedSearchUpdateInput
): Promise<SavedSearchRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }

  const assignments: string[] = [];
  const params: unknown[] = [];

  const pushAssignment = (column: string, value: unknown) => {
    params.push(value);
    assignments.push(`${column} = $${params.length}`);
  };

  if (patch.name !== undefined) {
    pushAssignment('name', normalizeName(patch.name ?? ''));
  }
  if (patch.description !== undefined) {
    pushAssignment('description', normalizeDescription(patch.description ?? null));
  }
  if (patch.searchInput !== undefined) {
    pushAssignment('search_input', normalizeSearchInput(patch.searchInput));
  }
  if (patch.statusFilters !== undefined) {
    pushAssignment('status_filters', normalizeStatusFiltersInput(patch.statusFilters));
  }
  if (patch.sort !== undefined) {
    pushAssignment('sort', normalizeSortInput(patch.sort));
  }
  if (patch.category !== undefined) {
    pushAssignment('category', normalizeCategory(patch.category));
  }
  if (patch.config !== undefined) {
    pushAssignment('config', normalizeConfig(patch.config as JsonValue | undefined));
  }

  if (assignments.length === 0) {
    return getSavedSearchBySlug(owner, normalizedSlug);
  }

  assignments.push('updated_at = NOW()');

  return useTransaction(async (client) => {
    const updateQuery = `
      UPDATE saved_catalog_searches
      SET ${assignments.join(', ')}
      WHERE slug = $${params.length + 1}
        AND owner_key = $${params.length + 2}
      RETURNING *
    `;

    const { rows } = await client.query<SavedCatalogSearchRow>(updateQuery, [...params, normalizedSlug, owner.key]);
    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}

export async function deleteSavedSearch(owner: SavedSearchOwner, slug: string): Promise<boolean> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
    return false;
  }

  return useTransaction(async (client) => {
    const { rowCount } = await client.query(
      'DELETE FROM saved_catalog_searches WHERE slug = $1 AND owner_key = $2',
      [normalizedSlug, owner.key]
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function recordSavedSearchApplied(
  owner: SavedSearchOwner,
  slug: string
): Promise<SavedSearchRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
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
      [normalizedSlug, owner.key]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}

export async function recordSavedSearchShared(
  owner: SavedSearchOwner,
  slug: string
): Promise<SavedSearchRecord | null> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!normalizedSlug) {
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
      [normalizedSlug, owner.key]
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  });
}
