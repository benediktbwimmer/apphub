import type { PoolClient } from 'pg';
import { useConnection, useTransaction } from './utils';
import {
  ALL_INGEST_STATUSES,
  type IngestStatus,
  type IngestionEvent,
  type JsonValue,
  type LaunchEnvVar,
  type RepositoryInsert,
  type RepositoryPreview,
  type RepositoryPreviewInput,
  type RepositoryRecord,
  type RepositoryRecordWithRelevance,
  type RepositoryRelevance,
  type RepositoryRelevanceComponent,
  type RepositorySearchMeta,
  type RepositorySearchParams,
  type RepositorySearchResult,
  type RepositorySort,
  type RelevanceWeights,
  type TagFacet,
  type TagKV,
  type TagSuggestion
} from './types';
import {
  mapIngestionEventRow,
  mapRepositoryPreviewRow,
  mapRepositoryRow,
  parseLaunchEnv
} from './rowMappers';
import type {
  BuildRow,
  IngestionEventRow,
  LaunchRow,
  RepositoryPreviewRow,
  RepositoryRow,
  TagRow
} from './rowTypes';
import { emitApphubEvent } from '../events';

const TEXT_TOKEN_PATTERN = /[a-z0-9]+/gi;

const DEFAULT_RELEVANCE_WEIGHTS: RelevanceWeights = {
  name: 4,
  description: 1.5,
  tags: 2
};

type RepositoryContext = {
  tags: Map<string, TagRow[]>;
  latestBuild: Map<string, BuildRow>;
  latestLaunch: Map<string, LaunchRow>;
  previews: Map<string, RepositoryPreviewRow[]>;
};

function tokenizeSearchText(text?: string | null): string[] {
  if (!text) {
    return [];
  }
  const matches = text.toLowerCase().match(TEXT_TOKEN_PATTERN);
  if (!matches) {
    return [];
  }
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of matches) {
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
      if (tokens.length >= 12) {
        break;
      }
    }
  }
  return tokens;
}

function buildTsQuery(tokens: string[]): string {
  return tokens
    .map((token) => token.replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean)
    .map((token) => `${token}:*`)
    .join(' & ');
}

function computeComponent(hits: number, weight: number): RepositoryRelevanceComponent {
  return {
    hits,
    weight,
    score: hits * weight
  } satisfies RepositoryRelevanceComponent;
}

async function loadRepositoryContext(client: PoolClient, repositoryIds: string[]): Promise<RepositoryContext> {
  if (repositoryIds.length === 0) {
    return {
      tags: new Map(),
      latestBuild: new Map(),
      latestLaunch: new Map(),
      previews: new Map()
    } satisfies RepositoryContext;
  }

  const tags = new Map<string, TagRow[]>();
  const builds = new Map<string, BuildRow>();
  const launches = new Map<string, LaunchRow>();
  const previews = new Map<string, RepositoryPreviewRow[]>();

  const { rows: tagRows } = await client.query<TagRow>(
    `SELECT rt.repository_id, t.key, t.value, rt.source
     FROM repository_tags rt
     JOIN tags t ON t.id = rt.tag_id
     WHERE rt.repository_id = ANY($1)
    `,
    [repositoryIds]
  );
  for (const row of tagRows) {
    const list = tags.get(row.repository_id);
    if (list) {
      list.push(row);
    } else {
      tags.set(row.repository_id, [row]);
    }
  }

  const { rows: buildRows } = await client.query<BuildRow>(
    `SELECT DISTINCT ON (repository_id) *
     FROM builds
     WHERE repository_id = ANY($1)
     ORDER BY repository_id, created_at DESC`,
    [repositoryIds]
  );
  for (const row of buildRows) {
    builds.set(row.repository_id, row);
  }

  const { rows: launchRows } = await client.query<LaunchRow>(
    `SELECT DISTINCT ON (repository_id) *
     FROM launches
     WHERE repository_id = ANY($1)
     ORDER BY repository_id, created_at DESC`,
    [repositoryIds]
  );
  for (const row of launchRows) {
    launches.set(row.repository_id, row);
  }

  const { rows: previewRows } = await client.query<RepositoryPreviewRow>(
    `SELECT *
     FROM repository_previews
     WHERE repository_id = ANY($1)
     ORDER BY repository_id, sort_order ASC, id ASC`,
    [repositoryIds]
  );
  for (const row of previewRows) {
    const list = previews.get(row.repository_id);
    if (list) {
      list.push(row);
    } else {
      previews.set(row.repository_id, [row]);
    }
  }

  return {
    tags,
    latestBuild: builds,
    latestLaunch: launches,
    previews
  } satisfies RepositoryContext;
}

async function refreshRepositorySearchIndex(client: PoolClient, repositoryId: string): Promise<void> {
  await client.query(
    `INSERT INTO repository_search (repository_id, document, name, description, repo_url, tag_text, updated_at)
     SELECT r.id,
            setweight(to_tsvector('english', coalesce(r.name, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(r.description, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(string_agg(t.key || ':' || t.value, ' '), '')), 'C'),
            r.name,
            r.description,
            r.repo_url,
            coalesce(string_agg(t.key || ':' || t.value, ' '), ''),
            NOW()
     FROM repositories r
     LEFT JOIN repository_tags rt ON rt.repository_id = r.id
     LEFT JOIN tags t ON t.id = rt.tag_id
     WHERE r.id = $1
     GROUP BY r.id
     ON CONFLICT (repository_id) DO UPDATE
       SET document = EXCLUDED.document,
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           repo_url = EXCLUDED.repo_url,
           tag_text = EXCLUDED.tag_text,
           updated_at = NOW();`,
    [repositoryId]
  );
}

function buildRepositoryWhereClause(
  params: RepositorySearchParams,
  options: { includeText?: boolean; tableAlias?: string; tsQueryParam?: number | null } = {}
): { clause: string; values: unknown[] } {
  const includeText = options.includeText ?? true;
  const tableAlias = options.tableAlias ?? 'r';
  const conditions: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const addCondition = (sql: string, ...params: unknown[]) => {
    const replaced = sql.replace(/\$(\d+)/g, (_match, group) => `$${Number(group) + (index - 1)}`);
    conditions.push(replaced);
    for (const param of params) {
      values.push(param);
    }
    index += params.length;
  };

  if (params.text && includeText && options.tsQueryParam === null) {
    const pattern = `%${params.text.toLowerCase()}%`;
    addCondition(
      `(
        lower(${tableAlias}.name) LIKE $1 OR
        lower(${tableAlias}.description) LIKE $2 OR
        lower(${tableAlias}.repo_url) LIKE $3
      )`,
      pattern,
      pattern,
      pattern
    );
  }

  if (params.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      const key = tag.key.trim().toLowerCase();
      const value = tag.value.trim().toLowerCase();
      addCondition(
        `EXISTS (
          SELECT 1
          FROM repository_tags rt
          JOIN tags t ON t.id = rt.tag_id
          WHERE rt.repository_id = ${tableAlias}.id
            AND lower(t.key) = $1
            AND lower(t.value) = $2
        )`,
        key,
        value
      );
    }
  }

  if (params.statuses && params.statuses.length > 0) {
    addCondition(`${tableAlias}.ingest_status = ANY($1)`, params.statuses);
  }

  if (params.ingestedAfter) {
    addCondition(`${tableAlias}.last_ingested_at IS NOT NULL AND ${tableAlias}.last_ingested_at >= $1`, params.ingestedAfter);
  }

  if (params.ingestedBefore) {
    addCondition(`${tableAlias}.last_ingested_at IS NOT NULL AND ${tableAlias}.last_ingested_at <= $1`, params.ingestedBefore);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { clause, values };
}

export async function listRepositories(params: RepositorySearchParams): Promise<RepositorySearchResult> {
  return useConnection(async (client) => {
    const tokens = tokenizeSearchText(params.text);
    const requestedSort: RepositorySort = params.sort ?? (tokens.length > 0 ? 'relevance' : 'updated');
    const effectiveSort: RepositorySort = tokens.length === 0 && requestedSort === 'relevance' ? 'updated' : requestedSort;

    const weights: RelevanceWeights = {
      name: params.relevanceWeights?.name ?? DEFAULT_RELEVANCE_WEIGHTS.name,
      description: params.relevanceWeights?.description ?? DEFAULT_RELEVANCE_WEIGHTS.description,
      tags: params.relevanceWeights?.tags ?? DEFAULT_RELEVANCE_WEIGHTS.tags
    } satisfies RelevanceWeights;

    const whereValues: unknown[] = [];
    let tsQueryParamIndex: number | null = null;
    let whereClause = '';

    if (tokens.length > 0) {
      const tsQuery = buildTsQuery(tokens);
      tsQueryParamIndex = whereValues.length + 1;
      const baseClause = buildRepositoryWhereClause(
        params,
        { includeText: false, tableAlias: 'r', tsQueryParam: tsQueryParamIndex }
      );
      whereClause = baseClause.clause;
      whereValues.push(...baseClause.values);
      whereClause = whereClause ? `${whereClause} AND rs.document @@ to_tsquery('english', $${tsQueryParamIndex})` : `WHERE rs.document @@ to_tsquery('english', $${tsQueryParamIndex})`;
      whereValues.push(tsQuery);
    } else {
      const baseClause = buildRepositoryWhereClause(params, { includeText: true, tableAlias: 'r', tsQueryParam: null });
      whereClause = baseClause.clause;
      whereValues.push(...baseClause.values);
    }

    const orderClause =
      effectiveSort === 'name'
        ? 'ORDER BY LOWER(r.name) ASC'
        : effectiveSort === 'updated'
        ? 'ORDER BY r.updated_at DESC'
        : 'ORDER BY relevance_score DESC NULLS LAST, r.updated_at DESC';

    const selectSql = `
      SELECT r.*,
             ${tsQueryParamIndex ? `ts_rank_cd(rs.document, to_tsquery('english', $${tsQueryParamIndex}))` : 'NULL::double precision'} AS relevance_score
      FROM repositories r
      ${tsQueryParamIndex ? 'JOIN repository_search rs ON rs.repository_id = r.id' : 'LEFT JOIN repository_search rs ON rs.repository_id = r.id'}
      ${whereClause}
      ${orderClause}
    `;

    const { rows: repositoryRows } = await client.query<(RepositoryRow & { relevance_score: number | null })>(selectSql, whereValues);
    const repositoryIds = repositoryRows.map((row) => row.id);
    const context = await loadRepositoryContext(client, repositoryIds);

    const relevanceScores = new Map<string, number>();
    for (const row of repositoryRows) {
      if (row.relevance_score !== null && row.relevance_score !== undefined) {
        relevanceScores.set(row.id, Number(row.relevance_score));
      }
    }

    const records: RepositoryRecordWithRelevance[] = repositoryRows.map((row) => {
      const record = mapRepositoryRow(row, {
        tags: context.tags.get(row.id) ?? [],
        latestBuild: context.latestBuild.get(row.id) ?? null,
        latestLaunch: context.latestLaunch.get(row.id) ?? null,
        previews: context.previews.get(row.id) ?? []
      }) as RepositoryRecordWithRelevance;

      if (tokens.length > 0) {
        const lowerName = record.name.toLowerCase();
        const lowerDescription = record.description.toLowerCase();
        const lowerTags = record.tags.map((tag) => `${tag.key}:${tag.value}`).join(' ').toLowerCase();

        let nameHits = 0;
        let descriptionHits = 0;
        let tagHits = 0;

        for (const token of tokens) {
          if (lowerName.includes(token)) {
            nameHits += 1;
          }
          if (lowerDescription.includes(token)) {
            descriptionHits += 1;
          }
          if (lowerTags.includes(token)) {
            tagHits += 1;
          }
        }

        const components = {
          name: computeComponent(nameHits, weights.name),
          description: computeComponent(descriptionHits, weights.description),
          tags: computeComponent(tagHits, weights.tags)
        } satisfies RepositoryRelevance['components'];

        const normalizedScore = relevanceScores.get(record.id) ?? 0;
        record.relevance = {
          score: components.name.score + components.description.score + components.tags.score,
          normalizedScore,
          components
        } satisfies RepositoryRelevance;
      }

      return record;
    });

    const statusCount = new Map<IngestStatus, number>();
    for (const status of ALL_INGEST_STATUSES) {
      statusCount.set(status, 0);
    }

    const tagCount = new Map<string, { key: string; value: string; count: number }>();
    const ownerCount = new Map<string, number>();
    const frameworkCount = new Map<string, number>();

    for (const record of records) {
      statusCount.set(record.ingestStatus, (statusCount.get(record.ingestStatus) ?? 0) + 1);
      for (const tag of record.tags) {
        const key = `${tag.key}:${tag.value}`;
        const entry = tagCount.get(key);
        if (entry) {
          entry.count += 1;
        } else {
          tagCount.set(key, { key: tag.key, value: tag.value, count: 1 });
        }

        if (tag.key.toLowerCase() === 'owner') {
          ownerCount.set(tag.value, (ownerCount.get(tag.value) ?? 0) + 1);
        }
        if (tag.key.toLowerCase() === 'framework') {
          frameworkCount.set(tag.value, (frameworkCount.get(tag.value) ?? 0) + 1);
        }
      }
    }

    const statusFacets = ALL_INGEST_STATUSES.map((status) => ({
      status,
      count: statusCount.get(status) ?? 0
    }));

    const tagFacets: TagFacet[] = Array.from(tagCount.values())
      .sort((a, b) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        const keyCompare = a.key.localeCompare(b.key);
        if (keyCompare !== 0) {
          return keyCompare;
        }
        return a.value.localeCompare(b.value);
      })
      .slice(0, 50)
      .map((entry) => ({ key: entry.key, value: entry.value, count: entry.count }));

    const owners: TagFacet[] = Array.from(ownerCount.entries())
      .map(([value, count]) => ({ key: 'owner', value, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)))
      .slice(0, 10);

    const frameworks: TagFacet[] = Array.from(frameworkCount.entries())
      .map(([value, count]) => ({ key: 'framework', value, count }))
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)))
      .slice(0, 10);

    const meta: RepositorySearchMeta = {
      tokens,
      sort: effectiveSort,
      weights
    } satisfies RepositorySearchMeta;

    return {
      records,
      total: records.length,
      facets: {
        tags: tagFacets,
        statuses: statusFacets,
        owners,
        frameworks
      },
      meta
    } satisfies RepositorySearchResult;
  });
}

export async function getRepositoryById(id: string): Promise<RepositoryRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<RepositoryRow>('SELECT * FROM repositories WHERE id = $1', [id]);
    if (rows.length === 0) {
      return null;
    }
    const context = await loadRepositoryContext(client, [id]);
    return mapRepositoryRow(rows[0], {
      tags: context.tags.get(id) ?? [],
      latestBuild: context.latestBuild.get(id) ?? null,
      latestLaunch: context.latestLaunch.get(id) ?? null,
      previews: context.previews.get(id) ?? []
    });
  });
}

export async function getIngestionHistory(repositoryId: string, limit = 25): Promise<IngestionEvent[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<IngestionEventRow>(
      `SELECT *
       FROM ingestion_events
       WHERE repository_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [repositoryId, Math.max(1, Math.min(limit, 100))]
    );
    return rows.map(mapIngestionEventRow);
  });
}

function normalizeLaunchEnvEntries(entries?: LaunchEnvVar[] | null): JsonValue {
  if (!entries || entries.length === 0) {
    return [];
  }
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    if (!seen.has(key)) {
      seen.set(key, value);
    }
    if (seen.size >= 64) {
      break;
    }
  }
  return Array.from(seen.entries()).map(([key, value]) => ({ key, value }));
}

async function attachTags(
  client: PoolClient,
  repositoryId: string,
  tags: (TagKV & { source?: string })[]
): Promise<void> {
  if (tags.length === 0) {
    return;
  }

  for (const tag of tags) {
    if (!tag.key || !tag.value) {
      continue;
    }
    const normalizedKey = tag.key.trim();
    const normalizedValue = tag.value.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO tags (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key, value) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
      [normalizedKey, normalizedValue]
    );
    const tagId = rows[0]?.id;
    if (!tagId) {
      continue;
    }
    await client.query(
      `INSERT INTO repository_tags (repository_id, tag_id, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (repository_id, tag_id) DO UPDATE SET source = EXCLUDED.source`,
      [repositoryId, tagId, tag.source ?? 'manifest']
    );
  }
}

async function notifyRepositoryChanged(repositoryId: string): Promise<void> {
  const record = await getRepositoryById(repositoryId);
  if (record) {
    emitApphubEvent({ type: 'repository.updated', data: { repository: record } });
  }
}

export async function addRepository(repository: RepositoryInsert): Promise<RepositoryRecord> {
  const now = new Date().toISOString();
  const launchEnvTemplates = JSON.stringify(normalizeLaunchEnvEntries(repository.launchEnvTemplates));

  await useTransaction(async (client) => {
    await client.query(
      `INSERT INTO repositories (
         id, name, description, repo_url, dockerfile_path,
         ingest_status, updated_at, last_ingested_at, ingest_error,
         ingest_attempts, launch_env_templates, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        repository.id,
        repository.name,
        repository.description,
        repository.repoUrl,
        repository.dockerfilePath,
        repository.ingestStatus ?? 'pending',
        repository.updatedAt ?? now,
        repository.lastIngestedAt ?? null,
        repository.ingestError ?? null,
        repository.ingestAttempts ?? 0,
        launchEnvTemplates,
        now
      ]
    );

    if (repository.tags && repository.tags.length > 0) {
      await attachTags(client, repository.id, repository.tags);
    }

    await refreshRepositorySearchIndex(client, repository.id);
  });

  await setRepositoryStatus(repository.id, repository.ingestStatus ?? 'pending', {
    updatedAt: repository.updatedAt ?? now,
    ingestError: repository.ingestError ?? null,
    eventMessage: 'Queued for ingestion'
  });

  const record = await getRepositoryById(repository.id);
  if (!record) {
    throw new Error('failed to load repository after insert');
  }
  return record;
}

export async function upsertRepository(repository: RepositoryInsert): Promise<RepositoryRecord> {
  const now = new Date().toISOString();
  const launchEnvTemplates = JSON.stringify(normalizeLaunchEnvEntries(repository.launchEnvTemplates));
  const preserveAttempts = repository.ingestAttempts === undefined;
  const ingestAttempts = repository.ingestAttempts ?? 0;

  await useTransaction(async (client) => {
    await client.query(
      `INSERT INTO repositories (
         id, name, description, repo_url, dockerfile_path,
         ingest_status, updated_at, last_ingested_at, ingest_error,
         ingest_attempts, launch_env_templates, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         repo_url = EXCLUDED.repo_url,
         dockerfile_path = EXCLUDED.dockerfile_path,
         updated_at = EXCLUDED.updated_at,
         ingest_status = EXCLUDED.ingest_status,
         last_ingested_at = COALESCE(EXCLUDED.last_ingested_at, repositories.last_ingested_at),
         ingest_error = EXCLUDED.ingest_error,
         ingest_attempts = CASE WHEN $13 THEN repositories.ingest_attempts ELSE EXCLUDED.ingest_attempts END,
         launch_env_templates = EXCLUDED.launch_env_templates
       `,
      [
        repository.id,
        repository.name,
        repository.description,
        repository.repoUrl,
        repository.dockerfilePath,
        repository.ingestStatus ?? 'pending',
        repository.updatedAt ?? now,
        repository.lastIngestedAt ?? null,
        repository.ingestError ?? null,
        ingestAttempts,
        launchEnvTemplates,
        now,
        preserveAttempts
      ]
    );

    await refreshRepositorySearchIndex(client, repository.id);
  });

  const record = await getRepositoryById(repository.id);
  if (!record) {
    throw new Error('repository missing after upsert');
  }
  return record;
}

export async function replaceRepositoryTags(
  repositoryId: string,
  tags: (TagKV & { source?: string })[],
  options: { clearExisting?: boolean; source?: string } = {}
): Promise<void> {
  await useTransaction(async (client) => {
    if (options.clearExisting ?? true) {
      await client.query('DELETE FROM repository_tags WHERE repository_id = $1', [repositoryId]);
    }
    const normalizedTags = tags.map((tag) => ({ ...tag, source: tag.source ?? options.source ?? 'system' }));
    await attachTags(client, repositoryId, normalizedTags);
    await refreshRepositorySearchIndex(client, repositoryId);
  });
  await notifyRepositoryChanged(repositoryId);
}

export async function replaceRepositoryPreviews(
  repositoryId: string,
  previews: RepositoryPreviewInput[]
): Promise<void> {
  await useTransaction(async (client) => {
    await client.query('DELETE FROM repository_previews WHERE repository_id = $1', [repositoryId]);
    let order = 0;
    for (const preview of previews) {
      await client.query(
        `INSERT INTO repository_previews (
           repository_id, kind, source, title, description, src, embed_url,
           poster_url, width, height, sort_order
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
          , [
            repositoryId,
            preview.kind,
            preview.source,
            preview.title ?? null,
            preview.description ?? null,
            preview.src ?? null,
            preview.embedUrl ?? null,
            preview.posterUrl ?? null,
            preview.width ?? null,
            preview.height ?? null,
            preview.sortOrder ?? order
          ]
      );
      order += 1;
    }
  });
  await notifyRepositoryChanged(repositoryId);
}

export async function getRepositoryPreviews(repositoryId: string): Promise<RepositoryPreview[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<RepositoryPreviewRow>(
      `SELECT * FROM repository_previews
       WHERE repository_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [repositoryId]
    );
    return rows.map(mapRepositoryPreviewRow);
  });
}

export async function updateRepositoryLaunchEnvTemplates(
  repositoryId: string,
  templates: LaunchEnvVar[]
): Promise<void> {
  const normalized = normalizeLaunchEnvEntries(templates);
  if (process.env.APPHUB_E2E_DEBUG_TEMPLATES) {
    console.log('[debug] normalized launch env templates', normalized);
  }
  const payload = JSON.stringify(normalized);
  await useTransaction(async (client) => {
    await client.query(
      `UPDATE repositories
       SET launch_env_templates = $2::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [repositoryId, payload]
    );
    await refreshRepositorySearchIndex(client, repositoryId);
  });
  await notifyRepositoryChanged(repositoryId);
}

export async function listTagSuggestions(prefix: string, limit: number): Promise<TagSuggestion[]> {
  return useConnection(async (client) => {
    const normalized = prefix.trim().toLowerCase();
    const effectiveLimit = Math.min(Math.max(limit, 1), 50);

    if (!normalized.includes(':')) {
      const { rows } = await client.query<{ key: string }>(
        `SELECT DISTINCT key
         FROM tags
         WHERE lower(key) LIKE $1
         ORDER BY key ASC
         LIMIT $2`,
        [`${normalized}%`, effectiveLimit]
      );
      return rows.map((row) => ({ type: 'key', value: row.key, label: row.key })) satisfies TagSuggestion[];
    }

    const [keyPart, valuePart] = normalized.split(':', 2);
    const likeKey = `${keyPart}%`;
    const likeValue = `${(valuePart ?? '').trim()}%`;
    const { rows } = await client.query<{ key: string; value: string }>(
      `SELECT DISTINCT key, value
       FROM tags
       WHERE lower(key) LIKE $1 AND lower(value) LIKE $2
       ORDER BY key ASC, value ASC
       LIMIT $3`,
      [likeKey, likeValue, effectiveLimit]
    );
    return rows.map((row) => ({
      type: 'pair',
      value: `${row.key}:${row.value}`,
      label: `${row.key}:${row.value}`
    })) satisfies TagSuggestion[];
  });
}

type StatusUpdateOptions = {
  ingestError?: string | null;
  updatedAt?: string | null;
  lastIngestedAt?: string | null;
  incrementAttempts?: boolean;
  eventMessage?: string | null;
  attempt?: number | null;
  commitSha?: string | null;
  durationMs?: number | null;
};

async function insertIngestionEvent(
  client: PoolClient,
  params: {
    repositoryId: string;
    status: IngestStatus;
    message?: string | null;
    attempt?: number | null;
    commitSha?: string | null;
    durationMs?: number | null;
  }
): Promise<IngestionEvent | null> {
  const { rows } = await client.query<IngestionEventRow>(
    `INSERT INTO ingestion_events (
       repository_id, status, message, attempt, commit_sha, duration_ms
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.repositoryId,
      params.status,
      params.message ?? null,
      params.attempt ?? null,
      params.commitSha ?? null,
      params.durationMs ?? null
    ]
  );
  if (rows.length === 0) {
    return null;
  }
  return mapIngestionEventRow(rows[0]);
}

export async function setRepositoryStatus(
  repositoryId: string,
  status: IngestStatus,
  options: StatusUpdateOptions = {}
): Promise<void> {
  const event = await useTransaction(async (client) => {
    const now = new Date().toISOString();
    await client.query(
      `UPDATE repositories
       SET ingest_status = $2,
           ingest_error = $3,
           updated_at = COALESCE($4, updated_at),
           last_ingested_at = COALESCE($5, last_ingested_at),
           ingest_attempts = CASE WHEN $6 THEN ingest_attempts + 1 ELSE ingest_attempts END
       WHERE id = $1`,
      [
        repositoryId,
        status,
        options.ingestError ?? null,
        options.updatedAt ?? now,
        options.lastIngestedAt ?? null,
        options.incrementAttempts === true
      ]
    );

    let eventMessage: IngestionEvent | null = null;
    if (options.eventMessage || options.commitSha || options.durationMs !== undefined) {
      eventMessage = await insertIngestionEvent(client, {
        repositoryId,
        status,
        message: options.eventMessage ?? null,
        attempt: options.attempt ?? null,
        commitSha: options.commitSha ?? null,
        durationMs: options.durationMs ?? null
      });
    }

    await refreshRepositorySearchIndex(client, repositoryId);
    return eventMessage;
  });

  if (event) {
    emitApphubEvent({ type: 'repository.ingestion-event', data: { event } });
  }
  await notifyRepositoryChanged(repositoryId);
}

export async function recordIngestionEvent(params: {
  repositoryId: string;
  status: IngestStatus;
  message?: string | null;
  attempt?: number | null;
  commitSha?: string | null;
  durationMs?: number | null;
}): Promise<IngestionEvent | null> {
  const event = await useTransaction(async (client) => {
    return insertIngestionEvent(client, params);
  });
  if (event) {
    emitApphubEvent({ type: 'repository.ingestion-event', data: { event } });
  }
  return event;
}

export async function takeNextPendingRepository(): Promise<RepositoryRecord | null> {
  const row = await useTransaction(async (client) => {
    const { rows } = await client.query<RepositoryRow>(
      `WITH next_repo AS (
         SELECT id
         FROM repositories
         WHERE ingest_status = 'pending'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE repositories r
       SET ingest_status = 'processing',
           ingest_error = NULL,
           updated_at = NOW()
       FROM next_repo
       WHERE r.id = next_repo.id
       RETURNING r.*`
    );
    return rows[0] ?? null;
  });

  if (!row) {
    return null;
  }
  const record = await getRepositoryById(row.id);
  if (record) {
    emitApphubEvent({ type: 'repository.updated', data: { repository: record } });
  }
  return record;
}

export async function getAllRepositories(): Promise<RepositoryRecord[]> {
  return useConnection(async (client) => {
    const { rows } = await client.query<RepositoryRow>('SELECT * FROM repositories ORDER BY name ASC');
    const context = await loadRepositoryContext(client, rows.map((row) => row.id));
    return rows.map((row) =>
      mapRepositoryRow(row, {
        tags: context.tags.get(row.id) ?? [],
        latestBuild: context.latestBuild.get(row.id) ?? null,
        latestLaunch: context.latestLaunch.get(row.id) ?? null,
        previews: context.previews.get(row.id) ?? []
      })
    );
  });
}

const RUN_DATA_NUKE_TABLES = [
  'service_network_launch_members',
  'service_network_members',
  'service_networks',
  'launches',
  'builds'
] as const;

const FULL_NUKE_TABLES = [
  ...RUN_DATA_NUKE_TABLES,
  'repository_previews',
  'repository_tags',
  'ingestion_events',
  'repository_search',
  'services',
  'repositories',
  'tags'
] as const;

export type NukeCatalogCounts = Record<string, number>;

async function truncateTables(tables: readonly string[]): Promise<NukeCatalogCounts> {
  return useTransaction(async (client) => {
    const counts: NukeCatalogCounts = {};

    for (const table of tables) {
      const { rows } = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
      counts[table] = Number(rows[0]?.count ?? 0);
      await client.query(`TRUNCATE TABLE ${table} CASCADE`);
    }

    return counts;
  });
}

export async function nukeCatalogRunData(): Promise<NukeCatalogCounts> {
  return truncateTables(RUN_DATA_NUKE_TABLES);
}

export async function nukeCatalogDatabase(): Promise<NukeCatalogCounts> {
  return truncateTables(FULL_NUKE_TABLES);
}
