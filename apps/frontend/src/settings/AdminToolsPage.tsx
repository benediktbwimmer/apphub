import classNames from 'classnames';
import { useCallback, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { coreRequest, CoreApiError } from '../core/api';
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
  const { identity, identityLoading, activeToken } = useAuth();
  const [isNukingRunData, setIsNukingRunData] = useState(false);
  const [isNukingCore, setIsNukingCore] = useState(false);
  const [isNukingEverything, setIsNukingEverything] = useState(false);
  const [runDataError, setRunDataError] = useState<string | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [everythingError, setEverythingError] = useState<string | null>(null);

  const hasDangerScope = identity?.scopes?.includes('admin:danger-zone') ?? false;
  const canUseDangerZone = Boolean(identity?.authDisabled || hasDangerScope);

  const handleNukeRunData = useCallback(async () => {
    if (!canUseDangerZone || isNukingRunData || isNukingCore || isNukingEverything) {
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
      if (!activeToken) {
        throw new Error('Authentication required to delete core run data.');
      }

      await coreRequest(activeToken, { method: 'POST', url: '/admin/core/nuke/run-data' });

      window.location.reload();
    } catch (err) {
      const message = err instanceof CoreApiError ? err.message : err instanceof Error && err.message ? err.message : 'Failed to delete core run data.';
      setRunDataError(message);
    } finally {
      setIsNukingRunData(false);
    }
  }, [activeToken, canUseDangerZone, isNukingCore, isNukingEverything, isNukingRunData]);

  const handleNukeCore = useCallback(async () => {
    if (!canUseDangerZone || isNukingCore || isNukingRunData || isNukingEverything) {
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
      if (!activeToken) {
        throw new Error('Authentication required to nuke the core database.');
      }

      await coreRequest(activeToken, { method: 'POST', url: '/admin/core/nuke' });

      window.location.reload();
    } catch (err) {
      const message = err instanceof CoreApiError ? err.message : err instanceof Error && err.message ? err.message : 'Failed to nuke the core database.';
      setCoreError(message);
    } finally {
      setIsNukingCore(false);
    }
  }, [activeToken, canUseDangerZone, isNukingCore, isNukingEverything, isNukingRunData]);

  const handleNukeEverything = useCallback(async () => {
    if (!canUseDangerZone || isNukingEverything || isNukingCore || isNukingRunData) {
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
      if (!activeToken) {
        throw new Error('Authentication required to nuke the entire database.');
      }

      await coreRequest(activeToken, { method: 'POST', url: '/admin/core/nuke/everything' });

      window.location.reload();
    } catch (err) {
      const message = err instanceof CoreApiError ? err.message : err instanceof Error && err.message ? err.message : 'Failed to nuke the entire database.';
      setEverythingError(message);
    } finally {
      setIsNukingEverything(false);
    }
  }, [activeToken, canUseDangerZone, isNukingCore, isNukingEverything, isNukingRunData]);

  const isBusy = isNukingRunData || isNukingCore || isNukingEverything;
  const controlsDisabled = isBusy || !canUseDangerZone;

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
          {!identityLoading && !canUseDangerZone && (
            <p className={SETTINGS_DANGER_META_TEXT_CLASSES}>
              An operator token with the <code>admin:danger-zone</code> scope is required to access these controls.
            </p>
          )}
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
              disabled={controlsDisabled}
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
              disabled={controlsDisabled}
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
              disabled={controlsDisabled}
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
