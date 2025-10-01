import { useAuth } from '../auth/useAuth';
import FilestoreExplorerPage from './FilestoreExplorerPage';

export default function FilestoreLayout() {
  const { identity, identityLoading } = useAuth();
  const authDisabled = identity?.authDisabled ?? false;
  const hasReadScope = authDisabled || (identity?.scopes.includes('filestore:read') ?? false);

  if (identityLoading) {
    return (
      <section className="rounded-3xl border border-subtle bg-surface-glass p-6 text-scale-sm text-secondary shadow-elevation-lg">
        Loading filestore access…
      </section>
    );
  }

  if (!hasReadScope) {
    return (
      <section className="rounded-3xl border border-status-warning bg-status-warning-soft p-6 shadow-elevation-lg">
        <h2 className="text-scale-lg font-weight-semibold text-status-warning">Filestore access required</h2>
        <p className="mt-2 text-scale-sm text-status-warning">
          Access denied. The active token is missing the <code className="font-mono">filestore:read</code> scope.
        </p>
        <p className="mt-2 text-scale-sm text-status-warning">
          Update your API key from the settings &gt; API access screen, then refresh this page to explore filestore nodes.
        </p>
      </section>
    );
  }

  return <FilestoreExplorerPage identity={identity ?? null} />;
}
