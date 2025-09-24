import { useCallback, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';

export default function AdminToolsPage() {
  const authorizedFetch = useAuthorizedFetch();
  const [isNukingRunData, setIsNukingRunData] = useState(false);
  const [isNukingCatalog, setIsNukingCatalog] = useState(false);
  const [isNukingEverything, setIsNukingEverything] = useState(false);
  const [runDataError, setRunDataError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [everythingError, setEverythingError] = useState<string | null>(null);

  const parseErrorMessage = useCallback((raw: string | null | undefined, fallback: string) => {
    if (!raw) {
      return fallback;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        return parsed.error.trim();
      }
    } catch {
      // Best effort parse; fall back to trimmed text below.
    }

    return trimmed.slice(0, 200);
  }, []);

  const handleNukeRunData = useCallback(async () => {
    if (isNukingRunData || isNukingCatalog || isNukingEverything) {
      return;
    }

    const confirmed = window.confirm(
      'This will permanently delete run data, including builds, launches, and service network state. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setIsNukingRunData(true);
    setRunDataError(null);

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/admin/catalog/nuke/run-data`, { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(parseErrorMessage(bodyText, 'Failed to delete catalog run data.'));
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to delete catalog run data.';
      setRunDataError(message);
    } finally {
      setIsNukingRunData(false);
    }
  }, [authorizedFetch, isNukingCatalog, isNukingEverything, isNukingRunData, parseErrorMessage]);

  const handleNukeCatalog = useCallback(async () => {
    if (isNukingCatalog || isNukingRunData || isNukingEverything) {
      return;
    }

    const confirmed = window.confirm(
      'This will permanently delete all catalog data, including apps, builds, launches, and services. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setIsNukingCatalog(true);
    setCatalogError(null);

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/admin/catalog/nuke`, { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(parseErrorMessage(bodyText, 'Failed to nuke the catalog database.'));
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to nuke the catalog database.';
      setCatalogError(message);
    } finally {
      setIsNukingCatalog(false);
    }
  }, [authorizedFetch, isNukingCatalog, isNukingEverything, isNukingRunData, parseErrorMessage]);

  const handleNukeEverything = useCallback(async () => {
    if (isNukingEverything || isNukingCatalog || isNukingRunData) {
      return;
    }

    const confirmed = window.confirm(
      'This will completely reset the catalog database, including all seeds, jobs, workflows, and historical data. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setIsNukingEverything(true);
    setEverythingError(null);

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/admin/catalog/nuke/everything`, { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(parseErrorMessage(bodyText, 'Failed to nuke the entire database.'));
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to nuke the entire database.';
      setEverythingError(message);
    } finally {
      setIsNukingEverything(false);
    }
  }, [authorizedFetch, isNukingCatalog, isNukingEverything, isNukingRunData, parseErrorMessage]);

  const isBusy = isNukingRunData || isNukingCatalog || isNukingEverything;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Admin tools</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Dangerous operations that require an operator token. Changes here are irreversible.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-rose-400/60 bg-rose-50/80 p-6 shadow-sm dark:border-rose-500/50 dark:bg-rose-500/10">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-300">
            Danger zone
          </h3>
          <p className="text-sm text-rose-700 dark:text-rose-200">
            Use these controls to delete run data (builds, launches, service network state) or wipe the entire
            catalog. There is no undo.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-rose-700 dark:text-rose-200">Delete run data only</div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/70 bg-rose-600/10 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:bg-rose-500/40"
              onClick={handleNukeRunData}
              disabled={isBusy}
            >
              {isNukingRunData ? 'Nuking run data…' : 'Nuke run data'}
            </button>
          </div>
          {runDataError && (
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-200" role="alert" aria-live="polite">
              {runDataError}
            </p>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-rose-700 dark:text-rose-200">
              Permanently delete all catalog data
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/70 bg-rose-600/10 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:bg-rose-500/40"
              onClick={handleNukeCatalog}
              disabled={isBusy}
            >
              {isNukingCatalog ? 'Nuking catalog…' : 'Nuke catalog'}
            </button>
          </div>
          {catalogError && (
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-200" role="alert" aria-live="polite">
              {catalogError}
            </p>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-rose-700 dark:text-rose-200">
              Reset everything (jobs, workflows, seeds, and catalog data)
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-rose-500/70 bg-rose-600/10 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-200 dark:hover:bg-rose-500/40"
              onClick={handleNukeEverything}
              disabled={isBusy}
            >
              {isNukingEverything ? 'Nuking everything…' : 'Nuke everything'}
            </button>
          </div>
          {everythingError && (
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-200" role="alert" aria-live="polite">
              {everythingError}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
