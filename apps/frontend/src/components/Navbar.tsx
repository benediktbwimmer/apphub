import { useCallback, useState } from 'react';
import { API_BASE_URL } from '../config';
import { type ActiveTab, useNavigation } from './NavigationContext';

interface NavbarProps {
  variant?: 'default' | 'overlay';
  onExitFullscreen?: () => void;
}

const TAB_LABELS: Record<ActiveTab, string> = {
  catalog: 'Catalog',
  apps: 'Apps',
  submit: 'Submit App',
  'import-manifest': 'Import Manifest'
};

export default function Navbar({ variant = 'default', onExitFullscreen }: NavbarProps) {
  const { activeTab, setActiveTab } = useNavigation();
  const isOverlay = variant === 'overlay';
  const [isNuking, setIsNuking] = useState(false);
  const [nukeError, setNukeError] = useState<string | null>(null);

  const handleTabClick = (tab: ActiveTab) => {
    if (tab === activeTab) {
      return;
    }

    setActiveTab(tab);

    if (isOverlay && onExitFullscreen) {
      onExitFullscreen();
    }
  };

  const containerClasses = isOverlay
    ? 'rounded-3xl border border-slate-700/70 bg-slate-900/80 px-5 py-4 text-slate-100 shadow-[0_25px_60px_-35px_rgba(15,23,42,1)] backdrop-blur'
    : 'rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-4 text-slate-900 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100';

  const tabGroupClasses = isOverlay
    ? 'inline-flex items-center justify-start gap-1 rounded-full border border-slate-700/70 bg-slate-800/70 p-1'
    : 'inline-flex items-center justify-start gap-1 rounded-full border border-slate-200/70 bg-slate-100/80 p-1 dark:border-slate-700/70 dark:bg-slate-800/70';

  const actionButtonClasses = isOverlay
    ? 'inline-flex items-center gap-2 rounded-full border border-red-400/60 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 transition-colors hover:bg-red-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 disabled:cursor-not-allowed disabled:opacity-60'
    : 'inline-flex items-center gap-2 rounded-full border border-red-500/60 bg-red-600/10 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-200 dark:hover:bg-red-500/40';

  const parseErrorMessage = useCallback((raw: string | null | undefined) => {
    if (!raw) {
      return 'Failed to nuke the catalog database.';
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      return 'Failed to nuke the catalog database.';
    }

    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown };
      if (parsed && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        return parsed.error.trim();
      }
    } catch {
      // Fall through to returning the trimmed string below.
    }

    return trimmed.slice(0, 200);
  }, []);

  const handleNukeCatalog = useCallback(async () => {
    if (isNuking) {
      return;
    }

    const confirmed = window.confirm(
      'This will permanently delete all catalog data, including apps, builds, launches, and services. Continue?'
    );
    if (!confirmed) {
      return;
    }

    setIsNuking(true);
    setNukeError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/admin/catalog/nuke`, { method: 'POST' });
      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(parseErrorMessage(bodyText));
      }

      window.location.reload();
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Failed to nuke the catalog database.';
      setNukeError(message);
    } finally {
      setIsNuking(false);
    }
  }, [isNuking, parseErrorMessage]);

  const getTabClasses = (tab: ActiveTab) => {
    const isActive = activeTab === tab;

    if (isActive) {
      return isOverlay
        ? 'rounded-full px-5 py-2 text-sm font-semibold text-slate-50 shadow-lg shadow-blue-500/20 ring-1 ring-inset ring-slate-500/40'
        : 'rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 dark:text-slate-50';
    }

    return isOverlay
      ? 'rounded-full px-5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700/70 hover:text-white'
      : 'rounded-full px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-blue-600/10 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';
  };

  return (
    <nav className={`flex flex-col gap-4 md:flex-row md:items-center md:justify-between ${containerClasses}`} aria-label="Primary">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.4em] text-blue-600 dark:text-blue-300">
          Osiris
        </span>
        <span className="text-lg font-semibold">AppHub</span>
      </div>
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
        <div className={tabGroupClasses} role="tablist" aria-label="Pages">
          {(Object.keys(TAB_LABELS) as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`${getTabClasses(tab)} transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500`}
              onClick={() => handleTabClick(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-col items-start gap-2 md:w-auto md:items-stretch">
          <div className="flex w-full flex-col items-start gap-2 md:flex-row md:items-center md:gap-2">
            {onExitFullscreen && (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-slate-700/50 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 md:self-stretch"
                onClick={onExitFullscreen}
              >
                <ExitFullscreenIcon />
                Exit fullscreen
              </button>
            )}
            <button
              type="button"
              className={actionButtonClasses}
              onClick={handleNukeCatalog}
              disabled={isNuking}
            >
              <NukeIcon />
              {isNuking ? 'Nuking catalog…' : 'Nuke catalog'}
            </button>
          </div>
          {nukeError && (
            <p className="text-xs font-semibold text-red-600 dark:text-red-300" role="alert" aria-live="polite">
              {nukeError}
            </p>
          )}
        </div>
      </div>
    </nav>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 12H5v3m7-7h3V5M12 12l3 3m-7-7L5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NukeIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 2.75a7.25 7.25 0 1 0 7.25 7.25A7.26 7.26 0 0 0 10 2.75Zm0 3.5v3.5m0 3.5h.008"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
