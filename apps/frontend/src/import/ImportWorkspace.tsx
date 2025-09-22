import { useEffect, useState } from 'react';
import ServiceManifestsTab from './tabs/ServiceManifestsTab';
import ImportAppsTab from './tabs/ImportAppsTab';
import ImportJobBundleTab from './tabs/ImportJobBundleTab';

export type ImportSubtab = 'service-manifests' | 'apps' | 'jobs';

type ImportWorkspaceProps = {
  onAppRegistered?: (id: string) => void;
  onManifestImported?: () => void;
  onViewCatalog?: () => void;
};

const SUBTAB_STORAGE_KEY = 'apphub-import-active-subtab';

const SUBTAB_LABELS: Record<ImportSubtab, string> = {
  'service-manifests': 'Service manifests',
  apps: 'Apps',
  jobs: 'Jobs'
};

function isImportSubtab(value: unknown): value is ImportSubtab {
  return value === 'service-manifests' || value === 'apps' || value === 'jobs';
}

const TAB_BUTTON_CLASSES =
  'rounded-full px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const TAB_ACTIVE_CLASSES = 'bg-violet-600 text-white shadow-lg shadow-violet-500/20 dark:bg-slate-200/30 dark:text-slate-50';

const TAB_INACTIVE_CLASSES =
  'text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

export default function ImportWorkspace({ onAppRegistered, onManifestImported, onViewCatalog }: ImportWorkspaceProps) {
  const [activeSubtab, setActiveSubtab] = useState<ImportSubtab>(() => {
    if (typeof window === 'undefined') {
      return 'service-manifests';
    }
    const stored = window.localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (isImportSubtab(stored)) {
      return stored;
    }
    return 'service-manifests';
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(SUBTAB_STORAGE_KEY, activeSubtab);
  }, [activeSubtab]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-500 dark:text-violet-300">
            Import workspace
          </span>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Manage manifests, register apps, and publish jobs
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Validate assets, resolve dependencies, and confirm imports before they reach operators and runtime
            environments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-full border border-slate-200/70 bg-slate-100/80 p-1 dark:border-slate-700/70 dark:bg-slate-800/70">
            {(Object.keys(SUBTAB_LABELS) as ImportSubtab[]).map((subtab) => {
              const isActive = subtab === activeSubtab;
              return (
                <button
                  key={subtab}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`${TAB_BUTTON_CLASSES} ${isActive ? TAB_ACTIVE_CLASSES : TAB_INACTIVE_CLASSES}`}
                  onClick={() => setActiveSubtab(subtab)}
                >
                  {SUBTAB_LABELS[subtab]}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {activeSubtab === 'service-manifests' && (
        <ServiceManifestsTab
          onImported={onManifestImported}
        />
      )}
      {activeSubtab === 'apps' && (
        <ImportAppsTab
          onAppRegistered={onAppRegistered}
          onViewCatalog={onViewCatalog}
        />
      )}
      {activeSubtab === 'jobs' && <ImportJobBundleTab />}
    </div>
  );
}
