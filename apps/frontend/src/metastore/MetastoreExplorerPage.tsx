import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { usePollingResource } from '../hooks/usePollingResource';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useToastHelpers } from '../components/toast';
import { Spinner } from '../components';
import { RecordTable } from './components/RecordTable';
import {
  searchRecords,
  fetchRecord,
  fetchRecordAudits,
  upsertRecord,
  patchRecord,
  deleteRecord,
  purgeRecord,
  bulkOperate
} from './api';
import type {
  MetastoreRecordDetail,
  MetastoreAuditEntry,
  MetastoreUpsertPayload,
  MetastorePatchPayload,
  BulkRequestPayload
} from './types';
import { BulkOperationsDialog } from './components/BulkOperationsDialog';
import {
  stringifyMetadata,
  parseMetadataInput,
  parseTagsInput,
  extractCrossLinks,
  mapMetastoreError,
  formatInstant
} from './utils';
import { ROUTE_PATHS } from '../routes/paths';
import { Link } from 'react-router-dom';
import JsonSyntaxHighlighter from '../components/JsonSyntaxHighlighter';

const POLL_INTERVAL = 20000;
const PAGE_SIZE = 25;

export default function MetastoreExplorerPage() {
  const { identity } = useAuth();
  const authorizedFetch = useAuthorizedFetch();
  const { showSuccess, showError, showInfo } = useToastHelpers();
  const scopes = identity?.scopes ?? [];
  const hasAdminScope = scopes.includes('metastore:admin');
  const hasDeleteScope = hasAdminScope || scopes.includes('metastore:delete');
  const hasWriteScope = hasDeleteScope || scopes.includes('metastore:write');
  const hasReadScope = hasWriteScope || scopes.includes('metastore:read');

  const [namespace, setNamespace] = useState('default');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const debouncedQueryInput = useDebouncedValue(queryInput, 300);
  const [page, setPage] = useState(0);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordDetail, setRecordDetail] = useState<MetastoreRecordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [metadataText, setMetadataText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [ownerText, setOwnerText] = useState('');
  const [schemaHashText, setSchemaHashText] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [patchText, setPatchText] = useState('');
  const [metadataUnsetText, setMetadataUnsetText] = useState('');
  const [tagPatchText, setTagPatchText] = useState('');
  const [audits, setAudits] = useState<MetastoreAuditEntry[]>([]);
  const [auditsLoading, setAuditsLoading] = useState(false);
  const [auditsError, setAuditsError] = useState<string | null>(null);
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  const offset = page * PAGE_SIZE;

  const searchFetcher = useCallback(
    async ({ authorizedFetch, signal }: { authorizedFetch: ReturnType<typeof useAuthorizedFetch>; signal: AbortSignal }) => {
      if (!hasReadScope) {
        return null;
      }

      const normalizedNamespace = namespace.trim() || 'default';
      const activeQuery = query.trim();
      const hasQuery = activeQuery.length > 0;
      const effectiveLimit = hasQuery ? 200 : PAGE_SIZE;
      const effectiveOffset = hasQuery ? 0 : offset;

      const payload = await searchRecords(
        authorizedFetch,
        {
          namespace: normalizedNamespace,
          includeDeleted,
          limit: effectiveLimit,
          offset: effectiveOffset,
          sort: [
            {
              field: 'updatedAt',
              direction: 'desc'
            }
          ]
        },
        { signal }
      );

      return payload;
    },
    [hasReadScope, namespace, includeDeleted, offset, query]
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

  const records = searchData?.records ?? null;
  const namespaceTotal = searchData?.pagination.total ?? (records?.length ?? 0);
  const activeQuery = query.trim();

  const filteredRecords = useMemo(() => {
    const baseRecords = records ?? [];
    if (!activeQuery) {
      return baseRecords;
    }
    const normalized = activeQuery.toLowerCase();
    return baseRecords.filter((record) => {
      return (
        record.recordKey.toLowerCase().includes(normalized) ||
        record.namespace.toLowerCase().includes(normalized) ||
        (record.owner ?? '').toLowerCase().includes(normalized) ||
        record.tags?.some((tag) => tag.toLowerCase().includes(normalized)) ||
        JSON.stringify(record.metadata ?? {}).toLowerCase().includes(normalized)
      );
    });
  }, [records, activeQuery]);

  const hasActiveQuery = activeQuery.length > 0;
  const displayTotal = hasActiveQuery ? filteredRecords.length : namespaceTotal;

  useEffect(() => {
    if (filteredRecords.length > 0) {
      if (!selectedRecordId || !filteredRecords.some((record) => record.id === selectedRecordId)) {
        setSelectedRecordId(filteredRecords[0].id);
      }
    } else {
      setSelectedRecordId(null);
      setRecordDetail(null);
    }
  }, [filteredRecords, selectedRecordId]);

  useEffect(() => {
    setPage(0);
  }, [namespace, includeDeleted]);

  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetail(null);
      setDetailError(null);
      return;
    }

    const recordSummary = (records ?? []).find((item) => item.id === selectedRecordId) ?? null;
    if (!recordSummary) {
      setRecordDetail(null);
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    const controller = new AbortController();
    fetchRecord(authorizedFetch, recordSummary.namespace, recordSummary.recordKey, {
      includeDeleted,
      signal: controller.signal
    })
      .then((detail) => {
        setRecordDetail(detail);
        setMetadataText(stringifyMetadata(detail.metadata));
        setTagsText((detail.tags ?? []).join(', '));
        setOwnerText(detail.owner ?? '');
        setSchemaHashText(detail.schemaHash ?? '');
        setMetadataError(null);
        setPatchText('');
        setMetadataUnsetText('');
        setTagPatchText('');
        setAudits([]);
        setAuditsError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
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
  }, [authorizedFetch, includeDeleted, selectedRecordId, records, showError]);

  const handleApplyQuery = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(queryInput);
    setPage(0);
  };

  const handleClearQuery = () => {
    setQueryInput('');
    setQuery('');
    setPage(0);
  };

  useEffect(() => {
    const trimmed = debouncedQueryInput.trim();
    if (query === trimmed) {
      return;
    }
    setQuery(trimmed);
    setPage(0);
  }, [debouncedQueryInput, query]);

  const handleRecordUpdate = async () => {
    if (!recordDetail) {
      return;
    }
    try {
      const metadata = parseMetadataInput(metadataText);
      const tags = parseTagsInput(tagsText);
      const payload = {
        metadata,
        tags,
        owner: ownerText.trim() ? ownerText.trim() : null,
        schemaHash: schemaHashText.trim() ? schemaHashText.trim() : null,
        expectedVersion: recordDetail.version
      } satisfies MetastoreUpsertPayload;

      const updated = await upsertRecord(authorizedFetch, recordDetail.namespace, recordDetail.recordKey, payload);
      showSuccess('Record updated', `Version ${updated.version}`);
      setRecordDetail(updated);
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

      const updated = await patchRecord(authorizedFetch, recordDetail.namespace, recordDetail.recordKey, payload);
      showSuccess('Patch applied', `Version ${updated.version}`);
      setRecordDetail(updated);
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
      const deleted = await deleteRecord(authorizedFetch, recordDetail.namespace, recordDetail.recordKey, {
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
      const restored = await upsertRecord(authorizedFetch, recordDetail.namespace, recordDetail.recordKey, {
        metadata: recordDetail.metadata,
        tags: recordDetail.tags,
        owner: recordDetail.owner,
        schemaHash: recordDetail.schemaHash ?? undefined,
        expectedVersion: recordDetail.version
      });
      showSuccess('Record restored');
      setRecordDetail(restored);
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
      await purgeRecord(authorizedFetch, recordDetail.namespace, recordDetail.recordKey, {
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

  const loadAudits = async () => {
    if (!recordDetail) {
      return;
    }
    try {
      setAuditsLoading(true);
      setAuditsError(null);
      const { entries } = await fetchRecordAudits(authorizedFetch, recordDetail.namespace, recordDetail.recordKey, {
        limit: 50
      });
      setAudits(entries);
    } catch (err) {
      setAuditsError(err instanceof Error ? err.message : 'Failed to load audit entries');
    } finally {
      setAuditsLoading(false);
    }
  };

  const bulkSubmit = async (payload: BulkRequestPayload) => {
    const response = await bulkOperate(authorizedFetch, payload);
    refetchSearch();
    return response;
  };

  const searchErrorMessage = searchError instanceof Error ? searchError.message : searchError ? String(searchError) : null;
  const currentRecord = recordDetail;
  const crossLinks = extractCrossLinks(currentRecord);

  if (!hasReadScope) {
    return (
      <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
        Access denied. The active token is missing the <code className="font-mono">metastore:read</code> scope.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Metastore Explorer</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Search, update, and audit metadata records across namespaces.
            </p>
          </div>
          <form className="flex flex-col gap-3 sm:flex-row sm:items-center" onSubmit={handleApplyQuery}>
            <div className="flex items-center gap-2">
              <label htmlFor="metastore-namespace" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                Namespace
              </label>
              <input
                id="metastore-namespace"
                type="text"
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
                className="w-40 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 text-sm text-slate-700 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="metastore-query" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                Search
              </label>
              <div className="flex items-center gap-2 rounded-full border border-slate-300/80 bg-white/80 px-3 py-1 shadow-sm focus-within:border-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80">
                <input
                  id="metastore-query"
                  type="search"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="Filter by key, owner, or metadata"
                  className="w-60 bg-transparent text-sm text-slate-700 outline-none dark:text-slate-100"
                />
                {queryInput && (
                  <button
                    type="button"
                    onClick={handleClearQuery}
                    className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(event) => setIncludeDeleted(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Include deleted
            </label>
            <button
              type="submit"
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              Apply
            </button>
          </form>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,320px),minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <RecordTable
            records={filteredRecords}
            selectedId={selectedRecordId}
            onSelect={(id) => setSelectedRecordId(id)}
            loading={searchLoading}
            error={searchErrorMessage}
            onRetry={refetchSearch}
            total={displayTotal}
          />
          <div className="flex flex-col gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center justify-between">
              <span>
                {hasActiveQuery
                  ? `Showing ${filteredRecords.length} matching records (namespace total ${namespaceTotal})`
                  : `Showing ${filteredRecords.length} of ${namespaceTotal} records`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(prev - 1, 0))}
                  disabled={hasActiveQuery || page === 0}
                  className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((prev) => prev + 1)}
                  disabled={hasActiveQuery || offset + PAGE_SIZE >= namespaceTotal}
                  className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
                >
                  Next
                </button>
              </div>
            </div>
            {hasActiveQuery && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Search is applied locally; results include up to the first 200 records for the selected namespace.
              </span>
            )}
          </div>
          {hasWriteScope && (
            <button
              type="button"
              onClick={() => setShowBulkDialog(true)}
              className="rounded-full border border-violet-500 px-4 py-2 text-sm font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-violet-400 dark:text-violet-300"
            >
              Bulk operations
            </button>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {detailLoading && !currentRecord ? (
            <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
              <div className="flex items-center justify-center py-10">
                <Spinner label="Loading record" />
              </div>
            </div>
          ) : detailError ? (
            <div className="rounded-3xl border border-rose-300/70 bg-rose-50/80 p-6 text-sm text-rose-600 shadow-[0_30px_70px_-45px_rgba(244,63,94,0.45)] backdrop-blur-md dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
              {detailError}
            </div>
          ) : currentRecord ? (
            <>
              <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
                <header className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">Record</span>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{currentRecord.recordKey}</h3>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      {currentRecord.namespace} • v{currentRecord.version}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRecordUpdate}
                      disabled={!hasWriteScope}
                      className="rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save record
                    </button>
                    <button
                      type="button"
                      onClick={handlePatch}
                      disabled={!hasWriteScope}
                      className="rounded-full border border-violet-500 px-4 py-2 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-400 dark:text-violet-300"
                    >
                      Apply patch
                    </button>
                    {currentRecord.deletedAt ? (
                      <button
                        type="button"
                        onClick={handleRestore}
                        className="rounded-full border border-emerald-500 px-4 py-2 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:border-emerald-400 dark:text-emerald-300"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={!hasDeleteScope}
                        className="rounded-full border border-rose-500 px-4 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-400 dark:text-rose-300"
                      >
                        Delete
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePurge}
                      disabled={!hasAdminScope}
                      className="rounded-full border border-rose-700 px-4 py-2 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-600/10 disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500 dark:text-rose-300"
                    >
                      Purge
                    </button>
                    {detailLoading && (
                      <span className="rounded-full border border-slate-300/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-700/60 dark:text-slate-300">
                        Refreshing…
                      </span>
                    )}
                  </div>
                </header>

                {metadataError && <p className="mt-3 text-sm text-rose-600 dark:text-rose-300">{metadataError}</p>}

                <section className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Metadata</span>
                    <textarea
                      value={metadataText}
                      onChange={(event) => setMetadataText(event.target.value)}
                      rows={12}
                      className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 font-mono text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                    />
                  </label>
                  <div className="flex flex-col gap-4">
                    <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Tags</span>
                      <input
                        type="text"
                        value={tagsText}
                        onChange={(event) => setTagsText(event.target.value)}
                        placeholder="Comma-separated list"
                        className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Owner</span>
                      <input
                        type="text"
                        value={ownerText}
                        onChange={(event) => setOwnerText(event.target.value)}
                        className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm text-slate-700 dark:text-slate-200">
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Schema hash</span>
                      <input
                        type="text"
                        value={schemaHashText}
                        onChange={(event) => setSchemaHashText(event.target.value)}
                        className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                      />
                    </label>
                    <section className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Patch payload (advanced)</h4>
                      <textarea
                        value={patchText}
                        onChange={(event) => setPatchText(event.target.value)}
                        rows={6}
                        placeholder='{ "metadata": { "path": "value" } }'
                        className="w-full rounded-xl border border-slate-300/60 bg-white/80 px-3 py-2 font-mono text-xs text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-100"
                      />
                      <input
                        type="text"
                        value={metadataUnsetText}
                        onChange={(event) => setMetadataUnsetText(event.target.value)}
                        placeholder="Metadata keys to unset (comma separated, e.g. details.foo)"
                        className="mt-2 w-full rounded-full border border-slate-300/60 bg-white/80 px-3 py-2 text-xs text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-100"
                      />
                      <textarea
                        value={tagPatchText}
                        onChange={(event) => setTagPatchText(event.target.value)}
                        rows={3}
                        placeholder='{ "add": ["tag"] }'
                        className="mt-2 w-full rounded-xl border border-slate-300/60 bg-white/80 px-3 py-2 font-mono text-xs text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/80 dark:text-slate-100"
                      />
                    </section>
                  </div>
                </section>

                <section className="mt-6 space-y-3 text-sm text-slate-700 dark:text-slate-200">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Cross-links</h4>
                  <div className="flex flex-wrap gap-2">
                    {crossLinks.datasetSlug ? (
                      <Link
                        to={`${ROUTE_PATHS.servicesTimestoreDatasets}?dataset=${encodeURIComponent(crossLinks.datasetSlug)}`}
                        className="rounded-full border border-violet-500 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-violet-400 dark:text-violet-300"
                      >
                        View dataset {crossLinks.datasetSlug}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">No dataset link</span>
                    )}
                    {crossLinks.assetId ? (
                      <Link
                        to={`${ROUTE_PATHS.assets}?asset=${encodeURIComponent(crossLinks.assetId)}`}
                        className="rounded-full border border-violet-500 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-violet-400 dark:text-violet-300"
                      >
                        View asset {crossLinks.assetId}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">No asset link</span>
                    )}
                  </div>
                </section>

                <section className="mt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Audit trail</h4>
                    <button
                      type="button"
                      onClick={loadAudits}
                      className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
                    >
                      Refresh audit
                    </button>
                  </div>
                  {auditsLoading ? (
                    <p className="text-sm text-slate-600 dark:text-slate-300">Loading audit log…</p>
                  ) : auditsError ? (
                    <p className="text-sm text-rose-600 dark:text-rose-300">{auditsError}</p>
                  ) : audits.length === 0 ? (
                    <p className="text-sm text-slate-600 dark:text-slate-300">No audit entries recorded yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {audits.map((entry) => (
                        <li key={entry.id} className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold capitalize text-slate-700 dark:text-slate-200">{entry.action}</span>
                            <span>{formatInstant(entry.createdAt)}</span>
                          </div>
                          <div className="mt-1">Actor: {entry.actor ?? 'system'} • Version: {entry.version ?? 'n/a'}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
                <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Record preview</h4>
                <div className="mt-3 overflow-x-auto">
                  <JsonSyntaxHighlighter value={currentRecord.metadata} />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
              Select a record to edit metadata, tags, and retention settings.
            </div>
          )}
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
