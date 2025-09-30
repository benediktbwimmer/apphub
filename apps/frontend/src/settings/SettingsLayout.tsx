import { NavLink, Outlet } from 'react-router-dom';
import { ROUTE_SEGMENTS } from '../routes/paths';

const TABS = [
  {
    key: 'appearance',
    label: 'Appearance',
    path: ROUTE_SEGMENTS.settingsAppearance,
    description: 'Switch between light, dark, or custom tenant themes.'
  },
  {
    key: 'preview',
    label: 'Preview Scaling',
    path: ROUTE_SEGMENTS.settingsPreview,
    description:
      'Adjust how embedded previews render inside the catalog and apps gallery.'
  },
  {
    key: 'api',
    label: 'API Access',
    path: ROUTE_SEGMENTS.settingsApiAccess,
    description: 'Manage operator tokens stored in your browser.'
  },
  {
    key: 'runtime-scaling',
    label: 'Runtime scaling',
    path: ROUTE_SEGMENTS.settingsRuntimeScaling,
    description: 'Review queue metrics and adjust worker concurrency at runtime.'
  },
  {
    key: 'import',
    label: 'Import workspace',
    path: ROUTE_SEGMENTS.settingsImport,
    description:
      'Register services, apps, jobs, and workflows from manifests, bundles, or built-in examples.'
  },
  {
    key: 'ai-builder',
    label: 'AI builder',
    path: ROUTE_SEGMENTS.settingsAiBuilder,
    description: 'Configure AI builder providers and credentials.'
  },
  {
    key: 'admin',
    label: 'Admin tools',
    path: ROUTE_SEGMENTS.settingsAdmin,
    description: 'Danger zone controls available to operators only.'
  }
] as const;

export default function SettingsLayout() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-300">
          Tailor AppHub to match your workspace. Choose a theme, adjust preview layouts, manage API access, and review runtime controls from a single place.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/70 bg-white/70 p-2 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60" role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.path}
            end
            className={({ isActive }) =>
              `rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                isActive
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30 dark:bg-violet-500'
                  : 'text-slate-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_25px_60px_-45px_rgba(15,23,42,0.6)] dark:border-slate-700/70 dark:bg-slate-900/60">
        <Outlet />
      </div>
    </section>
  );
}
