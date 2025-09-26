import { useCallback, useMemo } from 'react';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PRIMARY_NAV_ITEMS, type PrimaryNavKey } from '../routes/paths';

interface NavbarProps {
  variant?: 'default' | 'overlay';
  onExitFullscreen?: () => void;
}

type PathPredicate = (path: string) => boolean;

type IconProps = {
  className?: string;
};

type IconComponent = (props: IconProps) => JSX.Element;

const NAV_ICON_MAP: Record<PrimaryNavKey, IconComponent> = {
  overview: OverviewIcon,
  catalog: AppsIcon,
  assets: AssetsIcon,
  services: ServicesIcon,
  runs: RunsIcon,
  jobs: JobsIcon,
  workflows: WorkflowsIcon,
  schedules: SchedulesIcon,
  import: ImportIcon,
  settings: SettingsIcon
};

export default function Navbar({ variant = 'default', onExitFullscreen }: NavbarProps) {
  const location = useLocation();
  const isOverlay = variant === 'overlay';

  const activePath = useMemo(() => location.pathname.replace(/\/$/, '') || '/', [location.pathname]);

  const isPathActive = useCallback<PathPredicate>(
    (path) => {
      if (path === '/') {
        return activePath === '/';
      }
      return activePath === path || activePath.startsWith(`${path}/`);
    },
    [activePath]
  );

  if (isOverlay) {
    return <OverlayNavbar isPathActive={isPathActive} onExitFullscreen={onExitFullscreen} />;
  }

  return <SidebarNavbar isPathActive={isPathActive} />;
}

function SidebarNavbar({ isPathActive }: { isPathActive: PathPredicate }) {
  return (
    <aside className="flex-shrink-0 lg:sticky lg:top-10 lg:self-start">
      <div className="flex flex-col items-center gap-8 rounded-3xl border border-slate-200/70 bg-white/80 px-5 py-6 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600/15 text-xs font-bold uppercase tracking-[0.35em] text-violet-600 shadow-inner shadow-violet-500/25 dark:bg-violet-500/15 dark:text-violet-200">
            AH
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[0.55rem] font-semibold uppercase tracking-[0.6em] text-violet-600 dark:text-violet-300">
              Osiris
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">AppHub</span>
          </div>
        </div>
        <nav
          aria-label="Primary"
          className="flex w-full flex-row flex-wrap items-center justify-center gap-2 lg:flex-col lg:flex-nowrap lg:items-center lg:gap-3"
        >
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = NAV_ICON_MAP[item.key];
            const isActive = isPathActive(item.path);
            return (
              <Link
                key={item.key}
                to={item.path}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                className={getSidebarLinkClasses(isActive)}
              >
                <Icon className="h-5 w-5" />
                <Tooltip label={item.label} />
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

function getSidebarLinkClasses(isActive: boolean): string {
  const base =
    'group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-transparent text-slate-600 transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-slate-300';

  if (isActive) {
    return `${base} bg-violet-600 text-white shadow-lg shadow-violet-500/30 ring-1 ring-violet-400/60 dark:bg-violet-500 dark:text-slate-50`;
  }

  return `${base} hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-600 dark:hover:border-violet-400/30 dark:hover:bg-slate-800/80 dark:hover:text-violet-200`;
}

function Tooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-full z-10 mt-3 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 lg:left-full lg:top-1/2 lg:ml-3 lg:mt-0 lg:-translate-y-1/2 lg:translate-x-0 lg:shadow-xl dark:bg-slate-700/90"
    >
      {label}
    </span>
  );
}

function OverlayNavbar({ isPathActive, onExitFullscreen }: { isPathActive: PathPredicate; onExitFullscreen?: () => void }) {
  const containerClasses =
    'rounded-3xl border border-slate-700/70 bg-slate-900/80 px-5 py-4 text-slate-100 shadow-[0_25px_60px_-35px_rgba(15,23,42,1)] backdrop-blur';

  const tabGroupClasses = 'inline-flex items-center justify-start gap-1 rounded-full border border-slate-700/70 bg-slate-800/70 p-1';

  const getTabClasses = (isActive: boolean) => {
    if (isActive) {
      return 'rounded-full px-5 py-2 text-sm font-semibold text-slate-50 shadow-lg shadow-violet-500/20 ring-1 ring-inset ring-slate-500/40';
    }

    return 'rounded-full px-5 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700/70 hover:text-white';
  };

  return (
    <nav className={`flex flex-col gap-4 md:flex-row md:items-center md:justify-between ${containerClasses}`} aria-label="Primary">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.4em] text-violet-300">Osiris</span>
        <span className="text-lg font-semibold">AppHub</span>
      </div>
      <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:gap-4">
        <div className={tabGroupClasses} role="tablist" aria-label="Pages">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = isPathActive(item.path);
            return (
              <Link
                key={item.key}
                to={item.path}
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? 'page' : undefined}
                className={`${getTabClasses(isActive)} transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500`}
                onClick={() => {
                  if (!isActive && onExitFullscreen) {
                    onExitFullscreen();
                  }
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        {onExitFullscreen && (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-700/50 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-900/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 md:self-stretch"
            onClick={onExitFullscreen}
          >
            <ExitFullscreenIcon />
            Exit fullscreen
          </button>
        )}
      </div>
    </nav>
  );
}

function OverviewIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4a8 8 0 1 1-7.48 10.39" />
      <path d="M12 4v8l4 2" />
    </svg>
  );
}

function AppsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <path d="M17 14h3v3" />
      <path d="M14 17h6" />
    </svg>
  );
}

function AssetsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9.5 12 5l8 4.5-8 4.5-8-4.5Z" />
      <path d="M4 14.5 12 19l8-4.5" />
      <path d="M4 12l8 4.5 8-4.5" />
    </svg>
  );
}

function ServicesIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="6" width="16" height="12" rx="2.2" />
      <path d="M8 10h4" />
      <path d="M8 14h8" />
      <path d="M4 10h16" />
    </svg>
  );
}

function RunsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9.5 15 12l-5 2.5V9.5Z" />
    </svg>
  );
}

function JobsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="2.2" />
      <path d="m8.5 13 2 2 5-5" />
      <path d="M8 9h4" />
    </svg>
  );
}

function WorkflowsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6.5" cy="7" r="2.5" />
      <circle cx="17.5" cy="7" r="2.5" />
      <circle cx="12" cy="17" r="3" />
      <path d="M9 7h6" />
      <path d="M7.5 9.5 10 14" />
      <path d="M16.5 9.5 14 14" />
    </svg>
  );
}

function SchedulesIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M4 10h16" />
      <path d="M12 14.5 14.5 17 18 13.5" />
    </svg>
  );
}

function ImportIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v10" />
      <path d="M8.5 11.5 12 15l3.5-3.5" />
      <path d="M5 18h14" />
      <path d="M7 18h10" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
      <path d="m19.4 15.5-.82 1.42a1.3 1.3 0 0 1-1.43.6l-1.33-.36a4 4 0 0 1-1.92 1.11l-.32 1.35a1.3 1.3 0 0 1-1.28 1h-1.64a1.3 1.3 0 0 1-1.28-1l-.32-1.35a4 4 0 0 1-1.92-1.11l-1.33.36a1.3 1.3 0 0 1-1.43-.6l-.82-1.42a1.3 1.3 0 0 1 .28-1.56l1-.94a4 4 0 0 1 0-2.22l-1-.94a1.3 1.3 0 0 1-.28-1.56l.82-1.42a1.3 1.3 0 0 1 1.43-.6l1.33.36a4 4 0 0 1 1.92-1.11l.32-1.35A1.3 1.3 0 0 1 10.36 4h1.64a1.3 1.3 0 0 1 1.28 1l.32 1.35a4 4 0 0 1 1.92 1.11l1.33-.36a1.3 1.3 0 0 1 1.43.6l.82 1.42a1.3 1.3 0 0 1-.28 1.56l-1 .94a4 4 0 0 1 0 2.22l1 .94a1.3 1.3 0 0 1 .28 1.56Z" />
    </svg>
  );
}

function ExitFullscreenIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 12H5v3m7-7h3V5M12 12l3 3m-7-7L5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
