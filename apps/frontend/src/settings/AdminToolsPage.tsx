import classNames from 'classnames';
import { useCallback, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { getStatusToneClasses } from '../theme/statusTokens';
import {
  SETTINGS_DANGER_BUTTON_CLASSES,
  SETTINGS_DANGER_CARD_CONTAINER_CLASSES,
  SETTINGS_DANGER_META_TEXT_CLASSES,
  SETTINGS_DANGER_TEXT_CLASSES,
  SETTINGS_HEADER_SUBTITLE_CLASSES,
  SETTINGS_HEADER_TITLE_CLASSES
} from './settingsTokens';

export default function AdminToolsPage() {
  const authorizedFetch = useAuthorizedFetch();
  const [isNukingRunData, setIsNukingRunData] = useState(false);
  const [isNukingCore, setIsNukingCore] = useState(false);
  const [isNukingEverything, setIsNukingEverything] = useState(false);
  const [runDataError, setRunDataError] = useState<string | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
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
    if (isNukingRunData || isNukingCore || isNukingEverything) {
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
      const response = await authorizedFetch(`${API_BASE_URL}/admin/core/nuke/run-data`, { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(parseErrorMessage(bodyText, 'Failed to delete core run data.'));
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to delete core run data.';
      setRunDataError(message);
    } finally {
      setIsNukingRunData(false);
    }
  }, [authorizedFetch, isNukingCore, isNukingEverything, isNukingRunData, parseErrorMessage]);

  const handleNukeCore = useCallback(async () => {
    if (isNukingCore || isNukingRunData || isNukingEverything) {
      return;
    }

    const confirmed = window.confirm(
      'This will permanently delete all core data, including apps, builds, launches, and services. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setIsNukingCore(true);
    setCoreError(null);

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/admin/core/nuke`, { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(parseErrorMessage(bodyText, 'Failed to nuke the core database.'));
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to nuke the core database.';
      setCoreError(message);
    } finally {
      setIsNukingCore(false);
    }
  }, [authorizedFetch, isNukingCore, isNukingEverything, isNukingRunData, parseErrorMessage]);

  const handleNukeEverything = useCallback(async () => {
    if (isNukingEverything || isNukingCore || isNukingRunData) {
      return;
    }

    const confirmed = window.confirm(
      'This will completely reset the core database, including all seeds, jobs, workflows, and historical data. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setIsNukingEverything(true);
    setEverythingError(null);

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/admin/core/nuke/everything`, { method: 'POST' });
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
  }, [authorizedFetch, isNukingCore, isNukingEverything, isNukingRunData, parseErrorMessage]);

  const isBusy = isNukingRunData || isNukingCore || isNukingEverything;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2 className={SETTINGS_HEADER_TITLE_CLASSES}>Admin tools</h2>
        <p className={SETTINGS_HEADER_SUBTITLE_CLASSES}>
          Dangerous operations that require an operator token. Changes here are irreversible.
        </p>
      </header>

      <section className={SETTINGS_DANGER_CARD_CONTAINER_CLASSES}>
        <div className="flex flex-col gap-2">
          <h3 className={SETTINGS_DANGER_META_TEXT_CLASSES}>
            Danger zone
          </h3>
          <p className={SETTINGS_DANGER_TEXT_CLASSES}>
            Use these controls to delete run data (builds, launches, service network state) or wipe the entire
            core. There is no undo.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className={classNames('text-scale-sm font-weight-medium', SETTINGS_DANGER_TEXT_CLASSES)}>
              Delete run data only
            </div>
            <button
              type="button"
              className={classNames(SETTINGS_DANGER_BUTTON_CLASSES, getStatusToneClasses('danger'))}
              onClick={handleNukeRunData}
              disabled={isBusy}
            >
              {isNukingRunData ? 'Nuking run data…' : 'Nuke run data'}
            </button>
          </div>
          {runDataError && (
            <p className={SETTINGS_DANGER_META_TEXT_CLASSES} role="alert" aria-live="polite">
              {runDataError}
            </p>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className={classNames('text-scale-sm font-weight-medium', SETTINGS_DANGER_TEXT_CLASSES)}>
              Permanently delete all core data
            </div>
            <button
              type="button"
              className={classNames(SETTINGS_DANGER_BUTTON_CLASSES, getStatusToneClasses('danger'))}
              onClick={handleNukeCore}
              disabled={isBusy}
            >
              {isNukingCore ? 'Nuking core…' : 'Nuke core'}
            </button>
          </div>
          {coreError && (
            <p className={SETTINGS_DANGER_META_TEXT_CLASSES} role="alert" aria-live="polite">
              {coreError}
            </p>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className={classNames('text-scale-sm font-weight-medium', SETTINGS_DANGER_TEXT_CLASSES)}>
              Reset everything (jobs, workflows, seeds, and core data)
            </div>
            <button
              type="button"
              className={classNames(SETTINGS_DANGER_BUTTON_CLASSES, getStatusToneClasses('danger'))}
              onClick={handleNukeEverything}
              disabled={isBusy}
            >
              {isNukingEverything ? 'Nuking everything…' : 'Nuke everything'}
            </button>
          </div>
          {everythingError && (
            <p className={SETTINGS_DANGER_META_TEXT_CLASSES} role="alert" aria-live="polite">
              {everythingError}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
