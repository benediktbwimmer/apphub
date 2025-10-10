import { Spinner } from '../components';
import { useModuleScope } from './ModuleScopeContext';

export function ModuleScopeGate({ resourceName }: { resourceName: string }) {
  const moduleScope = useModuleScope();

  if (moduleScope.kind === 'module' && moduleScope.loadingResources) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label={`Loading module ${resourceName}`} size="md" />
      </div>
    );
  }

  if (moduleScope.kind === 'module' && moduleScope.resourcesError) {
    return (
      <section className="rounded-3xl border border-status-danger bg-status-danger-soft/20 p-10 text-center shadow-elevation-lg">
        <h1 className="text-scale-lg font-weight-semibold text-status-danger" aria-live="polite">
          {resourceName.charAt(0).toUpperCase() + resourceName.slice(1)}
        </h1>
        <p className="mt-2 text-scale-sm text-status-danger">
          {moduleScope.resourcesError}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-subtle bg-surface-glass p-10 text-center shadow-elevation-lg">
      <h1 className="text-scale-lg font-weight-semibold text-primary" aria-live="polite">
        {resourceName.charAt(0).toUpperCase() + resourceName.slice(1)}
      </h1>
      <p className="mt-2 text-scale-sm text-secondary">
        Select a module from the scope switcher to explore {resourceName}.
      </p>
    </section>
  );
}
