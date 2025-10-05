import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useToastHelpers } from '../components/toast';
import { CollapsibleSection, Spinner } from '../components';
import { RecordTable } from './components/RecordTable';
import { NamespacePicker } from './components/NamespacePicker';
import { searchRecords, fetchRecord, upsertRecord, patchRecord, deleteRecord, purgeRecord, bulkOperate } from './api';
import type { MetastoreRecordDetail, MetastoreUpsertPayload, MetastorePatchPayload, BulkRequestPayload } from './types';
import { BulkOperationsDialog } from './components/BulkOperationsDialog';
import { stringifyMetadata, parseMetadataInput, parseTagsInput, extractCrossLinks, mapMetastoreError } from './utils';
import { ROUTE_PATHS } from '../routes/paths';
import { Link } from 'react-router-dom';
import JsonSyntaxHighlighter from '../components/JsonSyntaxHighlighter';
import { AuditTrailPanel } from './components/AuditTrailPanel';
import { RealtimeActivityRail } from './components/RealtimeActivityRail';
import { FilestoreHealthRail } from './components/FilestoreHealthRail';
import SchemaAwareMetadataEditor from './components/SchemaAwareMetadataEditor';
import {
  buildQueryPayload,
  createEmptyClause,
  decodeClausesFromUrl,
  decodeDslFromUrl,
  encodeClausesForUrl,
  encodeDslForUrl,
  sanitizeClauses,
  type FilterNodeInput,
  type QueryClause
} from './queryComposer';
import { MetastoreQueryBuilder } from './components/MetastoreQueryBuilder';
import { useSchemaDefinition } from './useSchemaDefinition';
import {
  METASTORE_ALERT_ERROR_CLASSES,
  METASTORE_CARD_CONTAINER_CLASSES,
  METASTORE_CHECKBOX_CLASSES,
  METASTORE_ERROR_TEXT_CLASSES,
  METASTORE_FORM_FIELD_CONTAINER_CLASSES,
  METASTORE_INPUT_FIELD_CLASSES,
  METASTORE_LINK_ACCENT_CLASSES,
  METASTORE_META_TEXT_CLASSES,
  METASTORE_PILL_BADGE_NEUTRAL_CLASSES,
  METASTORE_PRIMARY_BUTTON_CLASSES,
  METASTORE_PRIMARY_BUTTON_SMALL_CLASSES,
  METASTORE_SECTION_LABEL_CLASSES,
  METASTORE_SECONDARY_BUTTON_CLASSES,
  METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
  METASTORE_SELECT_CLASSES,
  METASTORE_TEXT_AREA_MONO_CLASSES
} from './metastoreTokens';

const POLL_INTERVAL = 20000;
const PAGE_SIZE = 25;
const LIST_PROJECTION = [
  'namespace',
  'key',
  'createdAt',
  'owner',
  'schemaHash',
  'tags',
  'version',
  'updatedAt',
  'deletedAt'
] as const;

type AppliedQueryBase = {
  preset?: string | null;
};

type AppliedQueryState =
  | (AppliedQueryBase & {
      mode: 'search';
      search: string;
    })
  | (AppliedQueryBase & {
      mode: 'builder';
      q?: string;
      filter?: FilterNodeInput;
    })
  | (AppliedQueryBase & {
      mode: 'advanced';
      filter?: FilterNodeInput;
    });

type ComposerMode = 'search' | 'builder';

type QueryPreset = {
  value: string;
  label: string;
  description: string;
};

const METASTORE_PRESETS: readonly QueryPreset[] = [
  {
    value: 'recently-updated',
    label: 'Recently Updated',
    description: 'Changes in the last 24 hours'
  },
  {
    value: 'soft-deleted',
    label: 'Soft Deleted',
    description: 'Records awaiting purge'
  },
  {
    value: 'stale-gt-30d',
    label: 'Stale (>30d)',
    description: 'No updates in the past 30 days'
  }
] as const;

function parseFilterFromText(raw: string): FilterNodeInput | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as FilterNodeInput;
    return parsed;
  } catch (err) {
    console.warn('[MetastoreExplorer] Failed to parse DSL payload', err);
    return undefined;
  }
}

export default function MetastoreExplorerPage() {
  const { identity, activeToken } = useAuth();
  const { showSuccess, showError, showInfo } = useToastHelpers();
  const scopes = identity?.scopes ?? [];
  const hasAdminScope = scopes.includes('metastore:admin');
  const hasDeleteScope = hasAdminScope || scopes.includes('metastore:delete');
  const hasWriteScope = hasDeleteScope || scopes.includes('metastore:write');
  const hasReadScope = hasWriteScope || scopes.includes('metastore:read');
  const [searchParams, setSearchParams] = useSearchParams();

  const [namespace, setNamespace] = useState(() => searchParams.get('namespace') ?? 'default');
  const [includeDeleted, setIncludeDeleted] = useState(() => searchParams.get('deleted') === 'true');
  const [page, setPage] = useState(() => {
    const raw = Number.parseInt(searchParams.get('page') ?? '0', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  });

  const [builderClauses, setBuilderClauses] = useState<QueryClause[]>(() =>
    sanitizeClauses(decodeClausesFromUrl(searchParams.get('builder')))
  );
  const [builderPreset, setBuilderPreset] = useState<string | null>(() => searchParams.get('preset'));
  const [composerMode, setComposerMode] = useState<ComposerMode>(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'search') {
      return 'search';
    }
    if (modeParam === 'builder' || modeParam === 'advanced') {
      return 'builder';
    }
    return 'search';
  });
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [advancedDraft, setAdvancedDraft] = useState<string>(() => decodeDslFromUrl(searchParams.get('dsl')));
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [appliedQuery, setAppliedQuery] = useState<AppliedQueryState>(() => {
    const modeParam = searchParams.get('mode');
    const preset = searchParams.get('preset') ?? null;
    if (modeParam === 'search') {
      const term = (searchParams.get('search') ?? '').trim();
      if (term.length >= 2) {
        return {
          mode: 'search',
          search: term,
          preset
        } satisfies AppliedQueryState;
      }
    }
    if (modeParam === 'advanced') {
      const filter = parseFilterFromText(decodeDslFromUrl(searchParams.get('dsl')));
      return {
        mode: 'advanced',
        filter,
        preset
      } satisfies AppliedQueryState;
    }
    const clauses = sanitizeClauses(decodeClausesFromUrl(searchParams.get('builder')));
    const payload = buildQueryPayload(clauses);
    return {
      mode: 'builder',
      q: payload.q,
      filter: payload.filter,
      preset
    } satisfies AppliedQueryState;
  });

  const updateUrlParams = useCallback(
    (mutator: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mutator(next);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<MetastoreRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [metadataText, setMetadataText] = useState('');
  const [metadataDraft, setMetadataDraft] = useState<Record<string, unknown>>({});
  const [metadataMode, setMetadataMode] = useState<'schema' | 'json'>('json');
  const [schemaValidationErrors, setSchemaValidationErrors] = useState<Record<string, string>>({});
  const [metadataParseError, setMetadataParseError] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [ownerText, setOwnerText] = useState('');
  const [schemaHashText, setSchemaHashText] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [patchText, setPatchText] = useState('');
  const [metadataUnsetText, setMetadataUnsetText] = useState('');
  const [tagPatchText, setTagPatchText] = useState('');
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  const offset = page * PAGE_SIZE;

  const schemaHashDisplay = useMemo(() => schemaHashText.trim(), [schemaHashText]);
  const schemaLookupHash = useMemo(() => (schemaHashDisplay.length >= 6 ? schemaHashDisplay : null), [schemaHashDisplay]);

  const schemaState = useSchemaDefinition(activeToken, schemaLookupHash);

  const resetEditors = useCallback(
    (detail: MetastoreRecordDetail) => {
      setRecordDetail(detail);
      let nextMetadata: Record<string, unknown> = {};
      if (detail.metadata && typeof detail.metadata === 'object' && !Array.isArray(detail.metadata)) {
        try {
          nextMetadata = JSON.parse(JSON.stringify(detail.metadata)) as Record<string, unknown>;
        } catch {
          nextMetadata = { ...(detail.metadata as Record<string, unknown>) };
        }
      }
      setMetadataDraft(nextMetadata);
      setMetadataMode(detail.schemaHash ? 'schema' : 'json');
      setMetadataParseError(null);
      setSchemaValidationErrors({});
      setMetadataText(stringifyMetadata(nextMetadata));
      setTagsText((detail.tags ?? []).join(', '));
      setOwnerText(detail.owner ?? '');
      setSchemaHashText(detail.schemaHash ?? '');
      setMetadataError(null);
      setPatchText('');
      setMetadataUnsetText('');
      setTagPatchText('');
      setDetailError(null);
    },
    []
  );

  useEffect(() => {
    if (!schemaHashDisplay) {
      setMetadataMode('json');
    }
  }, [schemaHashDisplay]);

  useEffect(() => {
    if (appliedQuery.mode === 'advanced' && appliedQuery.filter && !advancedDraft.trim()) {
      setAdvancedDraft(JSON.stringify(appliedQuery.filter, null, 2));
    }
  }, [appliedQuery, advancedDraft]);

  const handleNamespaceChange = (nextNamespace: string) => {
    const normalized = nextNamespace.trim() || 'default';
    setNamespace(normalized);
    setPage(0);
    updateUrlParams((params) => {
      if (normalized && normalized !== 'default') {
        params.set('namespace', normalized);
      } else {
        params.delete('namespace');
      }
      params.set('page', '0');
    });
  };

  const handleIncludeDeletedChange = (checked: boolean) => {
    setIncludeDeleted(checked);
    setPage(0);
    updateUrlParams((params) => {
      if (checked) {
        params.set('deleted', 'true');
      } else {
        params.delete('deleted');
      }
      params.set('page', '0');
    });
  };

  const handlePresetChange = (value: string) => {
    setBuilderPreset(value === '' ? null : value);
  };

  const handleComposerModeChange = (mode: ComposerMode) => {
    setComposerMode(mode);
    if (mode === 'search') {
      setAdvancedError(null);
    }
  };

  const goToPage = (nextPage: number) => {
    const clamped = Math.max(Math.min(nextPage, totalPages - 1), 0);
    setPage(clamped);
    updateUrlParams((params) => {
      if (clamped === 0) {
        params.delete('page');
      } else {
        params.set('page', String(clamped));
      }
    });
  };

  const handlePreviousPage = () => {
    goToPage(Math.max(page - 1, 0));
  };

  const handleNextPage = () => {
    goToPage(Math.min(page + 1, totalPages - 1));
  };

  const applyFullTextSearch = useCallback(() => {
    const trimmed = searchDraft.trim();
    if (trimmed.length < 2) {
      const message = 'Enter at least two characters to run a full-text search.';
      showError('Full-text search requires more input', undefined, message);
      return;
    }
    const next: AppliedQueryState = {
      mode: 'search',
      search: trimmed,
      preset: builderPreset ?? null
    };
    setComposerMode('search');
    setSearchDraft(trimmed);
    setAppliedQuery(next);
    setAdvancedError(null);
    setPage(0);
    updateUrlParams((params) => {
      params.set('search', trimmed);
      if (builderPreset) {
        params.set('preset', builderPreset);
      } else {
        params.delete('preset');
      }
      params.set('mode', 'search');
      params.delete('builder');
      params.delete('dsl');
      params.set('page', '0');
    });
  }, [searchDraft, showError, builderPreset, updateUrlParams]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applyFullTextSearch();
  };

  const applyBuilder = useCallback(() => {
    const normalizedClauses = sanitizeClauses(builderClauses);
    setBuilderClauses(normalizedClauses);
    const payload = buildQueryPayload(normalizedClauses);
    const next: AppliedQueryState = {
      mode: 'builder',
      q: payload.q,
      filter: payload.filter,
      preset: builderPreset ?? null
    };
    setAppliedQuery(next);
    setAdvancedError(null);
    setPage(0);
    updateUrlParams((params) => {
      const encoded = encodeClausesForUrl(normalizedClauses);
      if (encoded) {
        params.set('builder', encoded);
      } else {
        params.delete('builder');
      }
      if (builderPreset) {
        params.set('preset', builderPreset);
      } else {
        params.delete('preset');
      }
      params.delete('search');
      params.set('mode', 'builder');
      params.delete('dsl');
      params.set('page', '0');
    });
  }, [builderClauses, builderPreset, updateUrlParams]);

  const resetBuilder = () => {
    setBuilderClauses([createEmptyClause()]);
    setBuilderPreset(null);
  };

  const applyAdvanced = () => {
    const parsed = parseFilterFromText(advancedDraft);
    if (!parsed && advancedDraft.trim()) {
      setAdvancedError('Invalid DSL JSON. Review the structure and try again.');
      return;
    }
    const normalizedClauses = sanitizeClauses(builderClauses);
    setBuilderClauses(normalizedClauses);
    const next: AppliedQueryState = {
      mode: 'advanced',
      filter: parsed,
      preset: builderPreset ?? null
    };
    setAppliedQuery(next);
    setAdvancedError(null);
    setPage(0);
    updateUrlParams((params) => {
      const encodedDsl = encodeDslForUrl(advancedDraft);
      if (encodedDsl) {
        params.set('dsl', encodedDsl);
      } else {
        params.delete('dsl');
      }
      if (builderPreset) {
        params.set('preset', builderPreset);
      } else {
        params.delete('preset');
      }
      const encodedBuilder = encodeClausesForUrl(normalizedClauses);
      if (encodedBuilder) {
        params.set('builder', encodedBuilder);
      } else {
        params.delete('builder');
      }
      params.delete('search');
      params.set('mode', 'advanced');
      params.set('page', '0');
    });
  };

  const clearFullTextSearch = useCallback(() => {
    setSearchDraft('');
    if (appliedQuery.mode === 'search') {
      applyBuilder();
      return;
    }
    updateUrlParams((params) => {
      params.delete('search');
    });
  }, [appliedQuery.mode, applyBuilder, updateUrlParams]);

  const searchFetcher = useCallback(
    async ({ signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!hasReadScope) {
        return null;
      }

      const normalizedNamespace = namespace.trim() || 'default';
      const requestBody: Record<string, unknown> = {
        namespace: normalizedNamespace,
        includeDeleted,
        limit: PAGE_SIZE,
        offset,
        sort: [
          {
            field: 'updatedAt',
            direction: 'desc'
          }
        ],
        projection: [...LIST_PROJECTION]
      };

      if (appliedQuery.mode === 'search') {
        requestBody.search = appliedQuery.search;
      } else if (appliedQuery.mode === 'builder') {
        if (appliedQuery.q) {
          requestBody.q = appliedQuery.q;
        }
        if (appliedQuery.filter) {
          requestBody.filter = appliedQuery.filter;
        }
      } else if (appliedQuery.filter) {
        requestBody.filter = appliedQuery.filter;
      }

      if (appliedQuery.preset) {
        requestBody.preset = appliedQuery.preset;
      }

      const payload = await searchRecords(activeToken, requestBody as Parameters<typeof searchRecords>[1], {
        signal
      });

      return payload;
    },
    [hasReadScope, namespace, includeDeleted, offset, appliedQuery, activeToken]
  );

  const {
    data: searchData,
    loading: searchLoading,
    error: searchError,
    refetch: refetchSearch
  } = usePollingResource({
    intervalMs: POLL_INTERVAL,
    fetcher: searchFetcher,
    enabled: hasReadScope,
    immediate: true
  });

  const records = useMemo(() => searchData?.records ?? [], [searchData]);
  const namespaceTotal = searchData?.pagination.total ?? 0;
  const totalPages = namespaceTotal === 0 ? 1 : Math.max(Math.ceil(namespaceTotal / PAGE_SIZE), 1);

  useEffect(() => {
    if (records.length > 0) {
      if (!selectedRecordId || !records.some((record) => record.id === selectedRecordId)) {
        setSelectedRecordId(records[0].id);
      }
    } else {
      setSelectedRecordId(null);
      setRecordDetail(null);
    }
  }, [records, selectedRecordId]);

  const lastFetchedDetailRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedRecordId) {
      lastFetchedDetailRef.current = null;
      setRecordDetail(null);
      setDetailError(null);
      return;
    }

    const recordSummary = records.find((item) => item.id === selectedRecordId) ?? null;
    if (!recordSummary) {
      lastFetchedDetailRef.current = null;
      setRecordDetail(null);
      return;
    }

    const signature = [
      recordSummary.namespace,
      recordSummary.recordKey,
      recordSummary.version,
      includeDeleted ? 'with-deleted' : 'active'
    ].join('|');

    if (lastFetchedDetailRef.current === signature) {
      // Skip refetching when polling yields an unchanged summary.
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    const controller = new AbortController();
    fetchRecord(activeToken, recordSummary.namespace, recordSummary.recordKey, {
      includeDeleted,
      signal: controller.signal
    })
      .then((detail) => {
        if (!controller.signal.aborted) {
          lastFetchedDetailRef.current = signature;
          resetEditors(detail);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          lastFetchedDetailRef.current = null;
          const message = err instanceof Error ? err.message : 'Failed to load record';
          setDetailError(message);
          showError('Failed to load record', err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeToken, includeDeleted, selectedRecordId, records, resetEditors, showError]);

  const handleRecordUpdate = async () => {
    if (!recordDetail) {
      return;
    }
    setMetadataError(null);

    if (metadataMode === 'schema' && schemaState.status === 'ready') {
      if (metadataParseError) {
        setMetadataError(metadataParseError);
        return;
      }
      if (Object.keys(schemaValidationErrors).length > 0) {
        setMetadataError('Fix schema validation errors before saving.');
        return;
      }
    }

    let metadata: Record<string, unknown>;
    try {
      if (metadataMode === 'schema' && schemaState.status === 'ready') {
        metadata = metadataDraft;
      } else {
        const parsed = parseMetadataInput(metadataText);
        metadata = parsed;
        setMetadataDraft(parsed);
        setMetadataParseError(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse metadata JSON';
      setMetadataParseError(message);
      setMetadataError(message);
      return;
    }
    try {
      const tags = parseTagsInput(tagsText);
      const payload = {
        metadata,
        tags,
        owner: ownerText.trim() ? ownerText.trim() : null,
        schemaHash: schemaHashText.trim() ? schemaHashText.trim() : null,
        expectedVersion: recordDetail.version
      } satisfies MetastoreUpsertPayload;

      const updated = await upsertRecord(activeToken, recordDetail.namespace, recordDetail.recordKey, payload);
      showSuccess('Record updated', `Version ${updated.version}`);
      resetEditors(updated);
      refetchSearch();
    } catch (err) {
      const message = mapMetastoreError(err);
      setMetadataError(message);
      showError('Failed to update record', err);
    }
  };

  const handlePatch = async () => {
    if (!recordDetail) {
      return;
    }
    try {
      const patchBody = patchText.trim() ? JSON.parse(patchText) : {};
      const metadataUnset = metadataUnsetText
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const tagsPatch = tagPatchText.trim() ? (JSON.parse(tagPatchText) as Record<string, unknown>) : undefined;

      const payload: MetastorePatchPayload = {
        ...(patchBody as Record<string, unknown>),
        metadataUnset: metadataUnset.length > 0 ? metadataUnset : undefined,
        tags: tagsPatch as MetastorePatchPayload['tags'],
        expectedVersion: recordDetail.version
      };

      const updated = await patchRecord(activeToken, recordDetail.namespace, recordDetail.recordKey, payload);
      showSuccess('Patch applied', `Version ${updated.version}`);
      resetEditors(updated);
      refetchSearch();
    } catch (err) {
      const message = mapMetastoreError(err);
      showError('Failed to apply patch', err);
      setMetadataError(message);
    }
  };

  const handleDelete = async () => {
    if (!recordDetail) {
      return;
    }
    if (!hasDeleteScope) {
      showInfo('Missing scope', 'metastore:delete scope is required to delete records.');
      return;
    }
    if (!window.confirm(`Soft delete ${recordDetail.namespace}/${recordDetail.recordKey}?`)) {
      return;
    }
    try {
      const deleted = await deleteRecord(activeToken, recordDetail.namespace, recordDetail.recordKey, {
        expectedVersion: recordDetail.version
      });
      showSuccess('Record soft deleted');
      setRecordDetail({ ...recordDetail, ...deleted, deletedAt: deleted.deletedAt ?? new Date().toISOString() });
      refetchSearch();
    } catch (err) {
      showError('Delete failed', err);
    }
  };

  const handleRestore = async () => {
    if (!recordDetail) {
      return;
    }
    try {
      const restored = await upsertRecord(activeToken, recordDetail.namespace, recordDetail.recordKey, {
        metadata: recordDetail.metadata,
        tags: recordDetail.tags,
        owner: recordDetail.owner,
        schemaHash: recordDetail.schemaHash ?? undefined,
        expectedVersion: recordDetail.version
      });
      showSuccess('Record restored');
      resetEditors(restored);
      refetchSearch();
    } catch (err) {
      showError('Restore failed', err);
    }
  };

  const handlePurge = async () => {
    if (!recordDetail) {
      return;
    }
    if (!hasAdminScope) {
      showInfo('Missing scope', 'metastore:admin scope is required to purge records.');
      return;
    }
    if (!window.confirm(`Permanently purge ${recordDetail.namespace}/${recordDetail.recordKey}? This cannot be undone.`)) {
      return;
    }
    try {
      await purgeRecord(activeToken, recordDetail.namespace, recordDetail.recordKey, {
        expectedVersion: recordDetail.version
      });
      showSuccess('Record purged');
      setRecordDetail(null);
      setSelectedRecordId(null);
      refetchSearch();
    } catch (err) {
      showError('Purge failed', err);
    }
  };

  const bulkSubmit = async (payload: BulkRequestPayload) => {
    const response = await bulkOperate(activeToken, payload);
    refetchSearch();
    return response;
  };

  const searchErrorMessage = searchError instanceof Error ? searchError.message : searchError ? String(searchError) : null;
  const currentRecord = recordDetail;
  const crossLinks = extractCrossLinks(currentRecord);
  const schemaBlockingErrors =
    metadataMode === 'schema' && (metadataParseError !== null || Object.keys(schemaValidationErrors).length > 0);
  const activePreset = useMemo(() => METASTORE_PRESETS.find((preset) => preset.value === builderPreset) ?? null, [builderPreset]);
  const appliedSearchSummary = useMemo(() => {
    if (appliedQuery.mode !== 'search') {
      return null;
    }
    return appliedQuery.search;
  }, [appliedQuery]);
  const builderSummary = useMemo(() => {
    if (appliedQuery.mode !== 'builder') {
      return null;
    }
    const parts: string[] = [];
    if (appliedQuery.q) {
      parts.push(`q: ${appliedQuery.q}`);
    }
    if (appliedQuery.filter) {
      const serialized = JSON.stringify(appliedQuery.filter);
      parts.push(`dsl: ${serialized.length > 140 ? `${serialized.slice(0, 140)}…` : serialized}`);
    }
    if (appliedQuery.preset) {
      parts.push(`preset: ${appliedQuery.preset}`);
    }
    return parts.length > 0 ? parts.join(' • ') : null;
  }, [appliedQuery]);

  if (!hasReadScope) {
    return (
      <section className={classNames(METASTORE_CARD_CONTAINER_CLASSES, 'text-scale-sm text-secondary')}>
        Access denied. The active token is missing the <code className="font-mono">metastore:read</code> scope.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className={classNames(METASTORE_CARD_CONTAINER_CLASSES, 'flex flex-col gap-6')}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-scale-lg font-weight-semibold text-primary">Metastore Explorer</h2>
            <p className="text-scale-sm text-secondary">Search, update, and audit metadata records across namespaces.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <NamespacePicker value={namespace} onChange={handleNamespaceChange} />
            <label className="inline-flex items-center gap-2 text-scale-sm text-secondary">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(event) => handleIncludeDeletedChange(event.target.checked)}
                className={METASTORE_CHECKBOX_CLASSES}
              />
              Include deleted
            </label>
            <label className="flex flex-col gap-1 text-secondary">
              <span className={METASTORE_SECTION_LABEL_CLASSES}>Preset</span>
              <select
                value={builderPreset ?? ''}
                onChange={(event) => handlePresetChange(event.target.value)}
                className={classNames(METASTORE_SELECT_CLASSES, 'mt-1 w-52')}
              >
                <option value="">No preset</option>
                {METASTORE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {activePreset && (
              <span className={classNames('max-w-xs', METASTORE_META_TEXT_CLASSES)}>{activePreset.description}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleComposerModeChange('search')}
            className={classNames(
              composerMode === 'search'
                ? METASTORE_PRIMARY_BUTTON_SMALL_CLASSES
                : METASTORE_SECONDARY_BUTTON_SMALL_CLASSES
            )}
          >
            Full-text search
          </button>
          <button
            type="button"
            onClick={() => handleComposerModeChange('builder')}
            className={classNames(
              composerMode === 'builder'
                ? METASTORE_PRIMARY_BUTTON_SMALL_CLASSES
                : METASTORE_SECONDARY_BUTTON_SMALL_CLASSES
            )}
          >
            Structured filters
          </button>
          {appliedSearchSummary && (
            <span className={classNames('ml-auto max-w-full truncate text-right sm:max-w-xs', METASTORE_META_TEXT_CLASSES)}>
              Active search: "{appliedSearchSummary}"
            </span>
          )}
        </div>
        {composerMode === 'search' ? (
          <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-3')}>
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3">
              <label className="flex flex-col gap-2">
                <span className={METASTORE_SECTION_LABEL_CLASSES}>Full-text search</span>
                <input
                  type="search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'h-11')}
                  placeholder="Search keys, owners, tags, and metadata"
                  autoComplete="off"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className={METASTORE_PRIMARY_BUTTON_CLASSES}>
                  Run search
                </button>
                <button type="button" onClick={clearFullTextSearch} className={METASTORE_SECONDARY_BUTTON_CLASSES}>
                  Clear search
                </button>
              </div>
              <p className={METASTORE_META_TEXT_CLASSES}>
                Enter at least two characters to query the full-text index across keys, owners, tags, and metadata.
              </p>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-4')}>
              <MetastoreQueryBuilder clauses={builderClauses} onChange={setBuilderClauses} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={applyBuilder} className={METASTORE_PRIMARY_BUTTON_CLASSES}>
                  Apply builder query
                </button>
                <button type="button" onClick={resetBuilder} className={METASTORE_SECONDARY_BUTTON_CLASSES}>
                  Reset builder
                </button>
                {appliedQuery.mode === 'advanced' && (
                  <span className={classNames(METASTORE_PILL_BADGE_NEUTRAL_CLASSES, 'border-accent text-accent')}>
                    Advanced mode active
                  </span>
                )}
              </div>
              {builderSummary && appliedQuery.mode === 'builder' && (
                <p className={classNames('whitespace-pre-wrap break-words', METASTORE_META_TEXT_CLASSES)}>{builderSummary}</p>
              )}
            </div>
            <CollapsibleSection
              title="Advanced DSL"
              description="Edit the search JSON directly for complex filters."
              defaultOpen={appliedQuery.mode === 'advanced'}
              onToggle={(isOpen) => {
                if (isOpen) {
                  if (
                    !advancedDraft.trim() &&
                    (appliedQuery.mode === 'builder' || appliedQuery.mode === 'advanced') &&
                    appliedQuery.filter
                  ) {
                    setAdvancedDraft(JSON.stringify(appliedQuery.filter, null, 2));
                  }
                  setAdvancedError(null);
                } else {
                  setAdvancedError(null);
                }
              }}
              className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'space-y-3 border-accent-soft bg-accent-soft/40')}
              contentClassName="space-y-3"
            >
              <label className="flex flex-col gap-2">
                <span className={METASTORE_SECTION_LABEL_CLASSES}>DSL JSON</span>
                <textarea
                  rows={8}
                  value={advancedDraft}
                  onChange={(event) => setAdvancedDraft(event.target.value)}
                  className={classNames(METASTORE_TEXT_AREA_MONO_CLASSES, 'min-h-[192px]')}
                  placeholder={'{ "field": "metadata.status", "operator": "eq", "value": "active" }'}
                />
              </label>
              {advancedError ? (
                <p className={classNames(METASTORE_ERROR_TEXT_CLASSES, 'flex flex-wrap items-center gap-2')}>
                  {advancedError}
                  <a
                    href="https://docs.apphub.dev/metastore/search"
                    target="_blank"
                    rel="noreferrer"
                    className={METASTORE_LINK_ACCENT_CLASSES}
                  >
                    View documentation
                  </a>
                </p>
              ) : (
                <p className={METASTORE_META_TEXT_CLASSES}>
                  Provide a filter tree matching the metastore search DSL. Apply to replace the builder query.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={applyAdvanced} className={METASTORE_PRIMARY_BUTTON_CLASSES}>
                  Apply DSL
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdvancedDraft('');
                    setAdvancedError(null);
                  }}
                  className={METASTORE_SECONDARY_BUTTON_CLASSES}
                >
                  Reset DSL
                </button>
              </div>
            </CollapsibleSection>
          </div>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px),minmax(0,1fr)] xl:grid-cols-[minmax(0,320px),minmax(0,1fr),minmax(280px,1fr)]">
        <div className="flex flex-col gap-3">
          <RecordTable
            records={records}
            selectedId={selectedRecordId}
            onSelect={(id) => setSelectedRecordId(id)}
            loading={searchLoading}
            error={searchErrorMessage}
            onRetry={refetchSearch}
            total={namespaceTotal}
          />
          <div className={classNames('flex flex-col gap-2', METASTORE_META_TEXT_CLASSES)}>
            <div className="flex items-center justify-between">
              <span>
                Showing {records.length} records • Page {Math.min(page + 1, totalPages)} of {totalPages} • Total {namespaceTotal}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePreviousPage}
                  disabled={page === 0 || namespaceTotal === 0}
                  className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={handleNextPage}
                  disabled={namespaceTotal === 0 || page >= totalPages - 1}
                  className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          {hasWriteScope && (
            <button
              type="button"
              onClick={() => setShowBulkDialog(true)}
              className={classNames(
                METASTORE_SECONDARY_BUTTON_CLASSES,
                'border-accent text-accent hover:border-accent-soft hover:bg-accent-soft/60 hover:text-accent-strong'
              )}
            >
              Bulk operations
            </button>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {detailLoading && !currentRecord ? (
            <div className={classNames(METASTORE_CARD_CONTAINER_CLASSES, 'text-scale-sm text-secondary')}>
              <div className="flex items-center justify-center py-10">
                <Spinner label="Loading record" />
              </div>
            </div>
          ) : detailError ? (
            <div className={METASTORE_ALERT_ERROR_CLASSES}>{detailError}</div>
          ) : currentRecord ? (
            <>
              <div className={classNames(METASTORE_CARD_CONTAINER_CLASSES, 'space-y-6')}>
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className={METASTORE_SECTION_LABEL_CLASSES}>Record</span>
                    <h3 className="text-scale-lg font-weight-semibold text-primary">{currentRecord.recordKey}</h3>
                    <p className={classNames('uppercase tracking-[0.2em]', METASTORE_META_TEXT_CLASSES)}>
                      {currentRecord.namespace} • v{currentRecord.version}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRecordUpdate}
                      disabled={!hasWriteScope || schemaBlockingErrors}
                      className={METASTORE_PRIMARY_BUTTON_SMALL_CLASSES}
                    >
                      Save record
                    </button>
                    <button
                      type="button"
                      onClick={handlePatch}
                      disabled={!hasWriteScope}
                      className={classNames(
                        METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                        'border-accent text-accent hover:border-accent-soft hover:bg-accent-soft/60 hover:text-accent-strong'
                      )}
                    >
                      Apply patch
                    </button>
                    {currentRecord.deletedAt ? (
                      <button
                        type="button"
                        onClick={handleRestore}
                        className={classNames(
                          METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                          'border-status-success text-status-success hover:bg-status-success-soft/40 hover:text-status-success'
                        )}
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={!hasDeleteScope}
                        className={classNames(
                          METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                          'border-status-danger text-status-danger hover:bg-status-danger-soft/40 hover:text-status-danger'
                        )}
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePurge}
                      disabled={!hasAdminScope}
                      className={classNames(
                        METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                        'border-status-danger text-status-danger hover:bg-status-danger-soft/40 hover:text-status-danger'
                      )}
                    >
                      Purge
                    </button>
                    {detailLoading && (
                      <span className={classNames(METASTORE_PILL_BADGE_NEUTRAL_CLASSES, 'text-secondary')}>
                        Refreshing…
                      </span>
                    )}
                  </div>
                </header>

                {metadataError && <p className="mt-3 text-scale-sm text-status-danger">{metadataError}</p>}

                <section className="flex flex-col gap-6">
                  <SchemaAwareMetadataEditor
                    schemaHash={schemaHashDisplay ? schemaHashDisplay : null}
                    schemaState={schemaState}
                    metadataMode={metadataMode}
                    onMetadataModeChange={setMetadataMode}
                    metadataDraft={metadataDraft}
                    onMetadataDraftChange={setMetadataDraft}
                    metadataText={metadataText}
                    onMetadataTextChange={setMetadataText}
                    parseError={metadataParseError}
                    onParseErrorChange={setMetadataParseError}
                    onValidationChange={setSchemaValidationErrors}
                    hasWriteScope={hasWriteScope}
                  />
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,320px),minmax(0,1fr)]">
                    <div className="flex flex-col gap-4">
                      <label className="flex flex-col gap-1 text-scale-sm text-secondary">
                        <span className={METASTORE_SECTION_LABEL_CLASSES}>Tags</span>
                        <input
                          type="text"
                          value={tagsText}
                          onChange={(event) => setTagsText(event.target.value)}
                          placeholder="Comma-separated list"
                          className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'rounded-full')}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-scale-sm text-secondary">
                        <span className={METASTORE_SECTION_LABEL_CLASSES}>Owner</span>
                        <input
                          type="text"
                          value={ownerText}
                          onChange={(event) => setOwnerText(event.target.value)}
                          className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'rounded-full')}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-scale-sm text-secondary">
                        <span className={METASTORE_SECTION_LABEL_CLASSES}>Schema hash</span>
                        <input
                          type="text"
                          value={schemaHashText}
                          onChange={(event) => setSchemaHashText(event.target.value)}
                          className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'rounded-full')}
                        />
                      </label>
                    </div>
                    <CollapsibleSection
                      title="Advanced patch options"
                      description="Apply JSON payloads or tag operations to the selected record."
                      className={classNames(METASTORE_FORM_FIELD_CONTAINER_CLASSES, 'text-scale-xs text-secondary')}
                      contentClassName="space-y-3"
                    >
                      <textarea
                        value={patchText}
                        onChange={(event) => setPatchText(event.target.value)}
                        rows={6}
                        placeholder='{ "metadata": { "path": "value" } }'
                        className={classNames(METASTORE_TEXT_AREA_MONO_CLASSES, 'min-h-[168px]')}
                      />
                      <input
                        type="text"
                        value={metadataUnsetText}
                        onChange={(event) => setMetadataUnsetText(event.target.value)}
                        placeholder="Metadata keys to unset (comma separated, e.g. details.foo)"
                        className={classNames(METASTORE_INPUT_FIELD_CLASSES, 'mt-2 rounded-full text-scale-xs')}
                      />
                      <textarea
                        value={tagPatchText}
                        onChange={(event) => setTagPatchText(event.target.value)}
                        rows={3}
                        placeholder='{ "add": ["tag"] }'
                        className={classNames(METASTORE_TEXT_AREA_MONO_CLASSES, 'mt-2 min-h-[120px]')}
                      />
                    </CollapsibleSection>
                  </div>
                </section>

                <section className="space-y-3 text-scale-sm text-secondary">
                  <h4 className={METASTORE_SECTION_LABEL_CLASSES}>Cross-links</h4>
                  <div className="flex flex-wrap gap-2">
                    {crossLinks.datasetSlug ? (
                      <Link
                        to={`${ROUTE_PATHS.servicesTimestoreDatasets}?dataset=${encodeURIComponent(crossLinks.datasetSlug)}`}
                        className={classNames(
                          METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                          'border-accent text-accent hover:border-accent-soft hover:bg-accent-soft/60 hover:text-accent-strong'
                        )}
                      >
                        View dataset {crossLinks.datasetSlug}
                      </Link>
                    ) : (
                      <span className={METASTORE_META_TEXT_CLASSES}>No dataset link</span>
                    )}
                    {crossLinks.assetId ? (
                      <Link
                        to={`${ROUTE_PATHS.assets}?asset=${encodeURIComponent(crossLinks.assetId)}`}
                        className={classNames(
                          METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                          'border-accent text-accent hover:border-accent-soft hover:bg-accent-soft/60 hover:text-accent-strong'
                        )}
                      >
                        View asset {crossLinks.assetId}
                      </Link>
                    ) : (
                      <span className={METASTORE_META_TEXT_CLASSES}>No asset link</span>
                    )}
                  </div>
                </section>

                <AuditTrailPanel
                  record={currentRecord}
                  token={activeToken}
                  hasWriteScope={hasWriteScope}
                  onRecordRestored={(restored) => {
                    resetEditors(restored);
                  }}
                  onRefreshRecords={refetchSearch}
                  showSuccess={showSuccess}
                  showError={showError}
                  showInfo={showInfo}
                />
              </div>

              <div className={classNames(METASTORE_CARD_CONTAINER_CLASSES, 'space-y-3')}>
                <h4 className={METASTORE_SECTION_LABEL_CLASSES}>Record preview</h4>
                <div className="mt-3 overflow-x-auto">
                  <JsonSyntaxHighlighter value={currentRecord.metadata} />
                </div>
              </div>
            </>
          ) : (
            <div className={classNames(METASTORE_CARD_CONTAINER_CLASSES, 'text-scale-sm text-secondary')}>
              Select a record to edit metadata, tags, and retention settings.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-24">
          <RealtimeActivityRail namespace={namespace} enabled={hasReadScope} />
          <FilestoreHealthRail enabled={hasReadScope} token={activeToken} />
        </div>
      </div>

      <BulkOperationsDialog
        open={showBulkDialog}
        onClose={() => setShowBulkDialog(false)}
        onSubmit={(payload) => bulkSubmit(payload)}
      />
    </section>
  );
}
