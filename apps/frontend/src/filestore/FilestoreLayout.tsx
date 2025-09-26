import { useAuth } from '../auth/useAuth';

export default function FilestoreLayout() {
  const { identity, identityLoading } = useAuth();
  const authDisabled = identity?.authDisabled ?? false;
  const hasReadScope = authDisabled || (identity?.scopes.includes('filestore:read') ?? false);

  if (identityLoading) {
    return (
      <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 text-sm text-slate-600 shadow dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
        Loading filestore access…
      </section>
    );
  }

  if (!hasReadScope) {
    return (
      <section className="rounded-3xl border border-amber-300/70 bg-amber-50/80 p-6 shadow-sm dark:border-amber-500/50 dark:bg-amber-500/10">
        <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-200">Filestore access required</h2>
        <p className="mt-2 text-sm text-amber-900/90 dark:text-amber-100">
          Access denied. The active token is missing the <code className="font-mono">filestore:read</code> scope.
        </p>
        <p className="mt-2 text-sm text-amber-900/80 dark:text-amber-100/80">
          Update your API key from the settings &gt; API access screen, then refresh this page to explore filestore nodes.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <article className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Filestore workspace</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Directory explorers, reconciliation monitors, and event streams will land here shortly. Use the typed helpers in{' '}
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800/70 dark:text-slate-200">
            apps/frontend/src/filestore
          </code>{' '}
          to integrate the existing APIs while we finish the UX.
        </p>
      </article>

      <article className="rounded-3xl border border-slate-200/70 bg-slate-50/70 p-6 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/50">
        <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">What to expect</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>Browse mounts, directories, and nodes with live metadata rollups.</li>
          <li>Kick off reconciliation jobs, monitor drift, and review command history.</li>
          <li>Tail streaming events and prototype write flows backed by reconciliation workers.</li>
        </ul>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Need additional privileges? Issue a key with{' '}
          <code className="font-mono">filestore:write</code>{' '}
          or{' '}
          <code className="font-mono">filestore:admin</code>{' '}
          scopes from the API access page.
        </p>
      </article>
    </section>
  );
}
