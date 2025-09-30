import { NavLink, Outlet } from 'react-router-dom';
import { ROUTE_SEGMENTS } from '../routes/paths';
import {
  SETTINGS_CARD_CONTAINER_CLASSES,
  SETTINGS_LAYOUT_HEADER_SUBTITLE_CLASSES,
  SETTINGS_LAYOUT_HEADER_TITLE_CLASSES,
  SETTINGS_TAB_ACTIVE_CLASSES,
  SETTINGS_TAB_CONTAINER_CLASSES,
  SETTINGS_TAB_INACTIVE_CLASSES
} from './settingsTokens';

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
        <h1 className={SETTINGS_LAYOUT_HEADER_TITLE_CLASSES}>Settings</h1>
        <p className={SETTINGS_LAYOUT_HEADER_SUBTITLE_CLASSES}>
          Tailor AppHub to match your workspace. Choose a theme, adjust preview layouts, manage API access, and review runtime controls from a single place.
        </p>
      </header>
      <div className={SETTINGS_TAB_CONTAINER_CLASSES} role="tablist" aria-label="Settings sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.path}
            end
            className={({ isActive }) => (isActive ? SETTINGS_TAB_ACTIVE_CLASSES : SETTINGS_TAB_INACTIVE_CLASSES)}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <div className={SETTINGS_CARD_CONTAINER_CLASSES}>
        <Outlet />
      </div>
    </section>
  );
}
