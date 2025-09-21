import { useEffect } from 'react';
import { useImportServiceManifest } from './useImportServiceManifest';

interface ImportServiceManifestProps {
  onImported?: () => void;
}

const SECTION_CLASSES =
  'flex flex-col gap-5 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] dark:border-slate-700/60 dark:bg-slate-900/70';

const INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30';

const FIELD_LABEL_CLASSES = 'text-sm font-semibold text-slate-700 dark:text-slate-200';

const SUBMIT_BUTTON =
  'inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-200/20 dark:text-slate-50 dark:hover:bg-slate-200/30';

const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-slate-200/70 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:border-violet-300 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

function ImportServiceManifest({ onImported }: ImportServiceManifestProps) {
  const {
    form,
    updateField,
    submitting,
    error,
    result,
    handleSubmit,
    resetResult,
    reimporting,
    canReimport,
    handleReimport
  } = useImportServiceManifest();

  useEffect(() => {
    if (!result) {
      return;
    }
    // Scroll the success summary into view when available so the user sees feedback immediately.
    const summary = document.getElementById('import-success-summary');
    summary?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  return (
    <section className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <form className={SECTION_CLASSES} onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="manifest-repo">
            Service Manifest Repository
          </label>
          <input
            id="manifest-repo"
            className={INPUT_CLASSES}
            value={form.repo}
            onChange={(event) => updateField('repo', event.target.value)}
            placeholder="https://github.com/user/service-manifest.git"
            required
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className={FIELD_LABEL_CLASSES} htmlFor="manifest-ref">
              Git Ref (optional)
            </label>
            <input
              id="manifest-ref"
              className={INPUT_CLASSES}
              value={form.ref}
              onChange={(event) => updateField('ref', event.target.value)}
              placeholder="main"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className={FIELD_LABEL_CLASSES} htmlFor="manifest-commit">
              Commit SHA (optional)
            </label>
            <input
              id="manifest-commit"
              className={INPUT_CLASSES}
              value={form.commit}
              onChange={(event) => updateField('commit', event.target.value)}
              placeholder="abcdef123456"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className={FIELD_LABEL_CLASSES} htmlFor="manifest-config-path">
              Config Path (optional)
            </label>
            <input
              id="manifest-config-path"
              className={INPUT_CLASSES}
              value={form.configPath}
              onChange={(event) => updateField('configPath', event.target.value)}
              placeholder="service-config.json"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className={FIELD_LABEL_CLASSES} htmlFor="manifest-module">
              Module Name (optional)
            </label>
            <input
              id="manifest-module"
              className={INPUT_CLASSES}
              value={form.module}
              onChange={(event) => updateField('module', event.target.value)}
              placeholder="github.com/user/module"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button type="submit" className={SUBMIT_BUTTON} disabled={submitting}>
            {submitting ? 'Importing…' : 'Import Service Manifest'}
          </button>
          {error && <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
      </form>
      <div className={SECTION_CLASSES}>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Import Status</h2>
        {!result && !error && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Provide the Git repository that hosts your service manifest configuration. AppHub will clone the
            module, append it to the local service configuration, and refresh the service registry.
          </p>
        )}
        {result && (
          <div id="import-success-summary" className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/70 p-4 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500 dark:text-emerald-300">
                Import completed
              </span>
              <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{result.module}</span>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Resolved Commit
                </dt>
                <dd className="text-sm text-slate-700 dark:text-slate-200">
                  {result.resolvedCommit ?? 'n/a'}
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Config Path
                </dt>
                <dd className="text-sm text-slate-700 dark:text-slate-200">{result.configPath}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Services
                </dt>
                <dd className="text-sm text-slate-700 dark:text-slate-200">{result.servicesDiscovered}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Service Networks
                </dt>
                <dd className="text-sm text-slate-700 dark:text-slate-200">{result.networksDiscovered}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-3">
              <button type="button" className={SECONDARY_BUTTON} onClick={resetResult}>
                Import another manifest
              </button>
              {canReimport && result.networksDiscovered > 0 && (
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={handleReimport}
                  disabled={reimporting}
                >
                  {reimporting ? 'Reimporting…' : 'Reimport service network manifest'}
                </button>
              )}
              {onImported && (
                <button type="button" className={SUBMIT_BUTTON} onClick={onImported}>
                  View catalog
                </button>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/15 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

export default ImportServiceManifest;
