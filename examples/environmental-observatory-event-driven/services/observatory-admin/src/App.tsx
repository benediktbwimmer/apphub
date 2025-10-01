import { useEffect, useMemo, useState } from 'react';
import { ApiProvider, ApiConfig } from './api/ApiProvider';
import { ToastProvider } from './components';
import ObservatoryOpsPage from './observatory/ObservatoryOpsPage';
import { useIsClient } from './hooks/useIsClient';
import { resolveDefaultApiConfig } from './config';

function AppShell() {
  const isClient = useIsClient();
  const fallbackConfig = resolveDefaultApiConfig();
  const storedConfig = useMemo<ApiConfig>(() => {
    if (typeof window === 'undefined') {
      return fallbackConfig;
    }
    const saved = window.localStorage.getItem('observatory-admin-config');
    if (!saved) {
      return fallbackConfig;
    }
    try {
      const parsed = JSON.parse(saved) as Partial<ApiConfig>;
      return {
        baseUrl:
          typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim().length > 0
            ? parsed.baseUrl.trim()
            : fallbackConfig.baseUrl,
        token: typeof parsed.token === 'string' ? parsed.token : fallbackConfig.token
      } satisfies ApiConfig;
    } catch {
      return fallbackConfig;
    }
  }, [fallbackConfig.baseUrl, fallbackConfig.token]);

  const [config, setConfig] = useState<ApiConfig>(storedConfig);

  const handleConfigChange = (next: ApiConfig) => {
    setConfig(next);
    if (isClient) {
      window.localStorage.setItem('observatory-admin-config', JSON.stringify(next));
    }
  };

  return (
    <ApiProvider value={config} onChange={handleConfigChange}>
      <ToastProvider>
        <div className="min-h-screen bg-slate-100 text-slate-900">
          <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">
                  Observatory
                </span>
                <h1 className="text-2xl font-semibold text-slate-900">Operations Admin</h1>
                <p className="text-sm text-slate-600">
                  Connect to an AppHub API instance and manage calibration uploads and reprocessing plans for the environmental observatory example.
                </p>
              </div>
              <ApiConnectionForm
                config={config}
                fallbackBaseUrl={fallbackConfig.baseUrl}
                onChange={handleConfigChange}
              />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">
            {config.token.trim().length === 0 ? (
              <div className="rounded-lg border border-amber-300 bg-amber-100/80 px-4 py-3 text-sm text-amber-900">
                Provide an operator token to enable authenticated calls to the Observatory endpoints.
              </div>
            ) : (
              <ObservatoryOpsPage />
            )}
          </main>
        </div>
      </ToastProvider>
    </ApiProvider>
  );
}

export default function App() {
  return <AppShell />;
}

function ApiConnectionForm({
  config,
  fallbackBaseUrl,
  onChange
}: {
  config: ApiConfig;
  fallbackBaseUrl: string;
  onChange: (next: ApiConfig) => void;
}) {
  const [formState, setFormState] = useState<ApiConfig>(config);

  useEffect(() => {
    setFormState(config);
  }, [config.baseUrl, config.token]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onChange({
      baseUrl: formState.baseUrl.trim() || fallbackBaseUrl,
      token: formState.token.trim()
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-[2fr,2fr,auto] md:items-end">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-sm font-medium text-slate-700">API base URL</span>
        <input
          type="url"
          name="baseUrl"
          value={formState.baseUrl}
          onChange={(event) => setFormState((state) => ({ ...state, baseUrl: event.target.value }))}
          placeholder="http://localhost:4000"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring focus:ring-sky-500/30"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-sm font-medium text-slate-700">Operator token</span>
        <input
          type="password"
          name="token"
          value={formState.token}
          onChange={(event) => setFormState((state) => ({ ...state, token: event.target.value }))}
          placeholder="Paste bearer token"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring focus:ring-sky-500/30"
        />
      </label>
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        Save connection
      </button>
    </form>
  );
}
