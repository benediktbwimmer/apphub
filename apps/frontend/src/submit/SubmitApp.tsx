import { useSubmitApp } from './useSubmitApp';

interface SubmitAppProps {
  onAppRegistered?: (id: string) => void;
}

const INPUT_CLASSES =
  'rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-violet-500 focus:ring-4 focus:ring-violet-200/40 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/30';

const TEXTAREA_CLASSES = `${INPUT_CLASSES} min-h-[120px] resize-y`;

const FIELD_LABEL_CLASSES = 'text-sm font-semibold text-slate-700 dark:text-slate-200';

const FIELD_HINT_CLASSES = 'text-xs text-slate-500 dark:text-slate-400';

const CHIP_CLASSES =
  'inline-flex items-center gap-2 rounded-full bg-slate-200/70 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700/60 dark:text-slate-200';

const TOGGLE_BUTTON_BASE =
  'inline-flex flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';

const TOGGLE_BUTTON_ACTIVE = `${TOGGLE_BUTTON_BASE} bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-slate-200/20 dark:text-slate-50 dark:shadow-[0_18px_40px_-28px_rgba(15,23,42,0.85)]`;

const TOGGLE_BUTTON_INACTIVE = `${TOGGLE_BUTTON_BASE} bg-white/70 text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100`;

const SMALL_BUTTON =
  'inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-200/10 dark:hover:text-slate-100';

const SUBMIT_BUTTON =
  'inline-flex items-center justify-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-200/20 dark:text-slate-50 dark:hover:bg-slate-200/30';

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]';

const STATUS_BADGE_VARIANTS: Record<string, string> = {
  ready:
    'border-emerald-400/70 bg-emerald-500/15 text-emerald-700 dark:border-emerald-400/60 dark:bg-emerald-500/20 dark:text-emerald-200',
  failed:
    'border-rose-400/70 bg-rose-500/15 text-rose-700 dark:border-rose-400/60 dark:bg-rose-500/20 dark:text-rose-200',
  processing:
    'border-sky-300/70 bg-sky-50/80 text-sky-700 dark:border-sky-400/60 dark:bg-sky-500/20 dark:text-sky-200',
  pending:
    'border-amber-300/70 bg-amber-50/80 text-amber-700 dark:border-amber-400/60 dark:bg-amber-500/20 dark:text-amber-200',
  seed: 'border-slate-300/70 bg-slate-100/70 text-slate-600 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-200'
};

const getStatusBadge = (status: string) =>
  `${STATUS_BADGE_BASE} ${STATUS_BADGE_VARIANTS[status] ?? STATUS_BADGE_VARIANTS.pending}`;

function SubmitApp({ onAppRegistered }: SubmitAppProps) {
  const {
    form,
    setForm,
    sourceType,
    setSourceType,
    submitting,
    error,
    currentApp,
    history,
    historyLoading,
    historyError,
    disableSubmit,
    handleSubmit,
    handleTagChange,
    addTagField,
    removeTagField,
    fetchHistory
  } = useSubmitApp(onAppRegistered);

  return (
    <section className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
      <form
        className="flex flex-col gap-5 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] dark:border-slate-700/60 dark:bg-slate-900/70"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="app-name">
            Application Name
          </label>
          <input
            id="app-name"
            className={INPUT_CLASSES}
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="My Awesome App"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="app-id">
            Application ID
          </label>
          <input
            id="app-id"
            className={INPUT_CLASSES}
            value={form.id}
            onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
            placeholder="Optional – auto-generated from name"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="app-description">
            Description
          </label>
          <textarea
            id="app-description"
            className={TEXTAREA_CLASSES}
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            placeholder="Short summary shown in the catalog"
            rows={3}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className={FIELD_LABEL_CLASSES}>Repository Source</span>
          <div className="flex gap-2 rounded-full border border-slate-200/70 bg-slate-100/70 p-1 dark:border-slate-700/60 dark:bg-slate-800/60">
            <button
              type="button"
              className={sourceType === 'remote' ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE}
              onClick={() => setSourceType('remote')}
            >
              Remote (git/https)
            </button>
            <button
              type="button"
              className={sourceType === 'local' ? TOGGLE_BUTTON_ACTIVE : TOGGLE_BUTTON_INACTIVE}
              onClick={() => setSourceType('local')}
            >
              Local path
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="repo-url">
            Repository URL or Path
          </label>
          <input
            id="repo-url"
            className={INPUT_CLASSES}
            value={form.repoUrl}
            onChange={(event) => setForm((prev) => ({ ...prev, repoUrl: event.target.value }))}
            placeholder={
              sourceType === 'local' ? '/absolute/path/to/repo' : 'https://github.com/user/project.git'
            }
            required
          />
          <p className={FIELD_HINT_CLASSES}>
            {sourceType === 'local'
              ? 'Provide an absolute path to a Git repository on this machine.'
              : 'Provide a cloneable Git URL (https://, git@, etc.).'}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <label className={FIELD_LABEL_CLASSES} htmlFor="dockerfile-path">
            Dockerfile Path
          </label>
          <input
            id="dockerfile-path"
            className={INPUT_CLASSES}
            value={form.dockerfilePath}
            onChange={(event) => setForm((prev) => ({ ...prev, dockerfilePath: event.target.value }))}
            placeholder="Dockerfile"
            required
          />
        </div>
        <div className="flex flex-col gap-3">
          <span className={FIELD_LABEL_CLASSES}>Tags</span>
          <div className="flex flex-col gap-3">
            {form.tags.map((tag, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3">
                <input
                  className={`${INPUT_CLASSES} flex-1 min-w-[120px]`}
                  value={tag.key}
                  onChange={(event) => handleTagChange(index, 'key', event.target.value)}
                  placeholder="key"
                />
                <span className="text-lg font-semibold text-slate-400 dark:text-slate-500">:</span>
                <input
                  className={`${INPUT_CLASSES} flex-1 min-w-[160px]`}
                  value={tag.value}
                  onChange={(event) => handleTagChange(index, 'value', event.target.value)}
                  placeholder="value"
                />
                {form.tags.length > 1 && (
                  <button type="button" className={SMALL_BUTTON} onClick={() => removeTagField(index)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className={SMALL_BUTTON} onClick={addTagField}>
              Add tag
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={SUBMIT_BUTTON} disabled={disableSubmit}>
            {submitting ? 'Submitting…' : 'Register Application'}
          </button>
          {error && (
            <div className="rounded-xl border border-rose-300/70 bg-rose-50/70 px-3 py-2 text-sm font-medium text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>
      </form>

      {currentApp && (
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.6)] dark:border-slate-700/60 dark:bg-slate-900/70">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Status</h2>
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={getStatusBadge(currentApp.ingestStatus)}>{currentApp.ingestStatus}</span>
              <span className={CHIP_CLASSES}>Attempts {currentApp.ingestAttempts}</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">{currentApp.description}</p>
            {currentApp.ingestError && (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{currentApp.ingestError}</p>
            )}
            <div className="grid gap-3 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Repo URL</span>
                <code className="break-all rounded-xl bg-slate-200/70 px-3 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  {currentApp.repoUrl}
                </code>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Dockerfile</span>
                <code className="break-all rounded-xl bg-slate-200/70 px-3 py-1 font-mono text-xs text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                  {currentApp.dockerfilePath}
                </code>
              </div>
            </div>
            <button type="button" className={SMALL_BUTTON} onClick={() => fetchHistory(currentApp.id)}>
              Refresh history
            </button>
          </div>
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/60">
            {historyLoading && <div className="text-sm text-slate-500 dark:text-slate-400">Loading history…</div>}
            {historyError && (
              <div className="text-sm font-medium text-rose-600 dark:text-rose-300">{historyError}</div>
            )}
            {!historyLoading && !historyError && history.length === 0 && (
              <div className="text-sm text-slate-500 dark:text-slate-400">No ingestion events yet.</div>
            )}
            {history.length > 0 && (
              <ul className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300">
                {history.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/60 dark:bg-slate-900/60"
                  >
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className={getStatusBadge(event.status)}>{event.status}</span>
                      <time className="text-slate-500 dark:text-slate-400" dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleString()}
                      </time>
                      {event.commitSha && (
                        <code className="rounded-full bg-slate-200/70 px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-200">
                          {event.commitSha.slice(0, 10)}
                        </code>
                      )}
                    </div>
                    <div className="mt-2 space-y-2">
                      <div className="font-medium text-slate-700 dark:text-slate-200">
                        {event.message ?? 'No additional message'}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                        {event.attempt !== null && <span>Attempt {event.attempt}</span>}
                        {typeof event.durationMs === 'number' && (
                          <span>{`${Math.max(event.durationMs, 0)} ms`}</span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default SubmitApp;
