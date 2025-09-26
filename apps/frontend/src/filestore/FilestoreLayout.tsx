import { useAuth } from '../auth/useAuth';
import FilestoreExplorerPage from './FilestoreExplorerPage';

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

  return <FilestoreExplorerPage identity={identity ?? null} />;
}
