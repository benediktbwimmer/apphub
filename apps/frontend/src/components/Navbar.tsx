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
  events: EventsIcon,
  assets: AssetsIcon,
  services: ServicesIcon,
  observatory: ObservatoryIcon,
  runs: RunsIcon,
  jobs: JobsIcon,
  workflows: WorkflowsIcon,
  topology: TopologyIcon,
  schedules: SchedulesIcon,
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
      <div className="flex h-full max-h-[calc(100vh-5rem)] flex-col items-center gap-6 rounded-3xl border border-subtle bg-surface-glass px-4 py-5 text-primary shadow-elevation-lg backdrop-blur-md">
        <div className="flex flex-col items-center text-center">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.6em] text-accent-soft">
            Osiris
          </span>
          <span className="text-scale-sm font-weight-semibold text-primary">AppHub</span>
        </div>
        <nav
          aria-label="Primary"
          className="flex w-full flex-1 flex-row flex-wrap items-center justify-center gap-2 overflow-y-auto pb-1 lg:flex-col lg:flex-nowrap lg:items-center lg:gap-2"
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
    'group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-transparent text-muted transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  if (isActive) {
    return `${base} bg-accent text-on-accent shadow-accent-soft ring-1 ring-accent`;
  }

  return `${base} hover:border-accent-soft hover:bg-accent-soft hover:text-accent`;
}

function Tooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-full z-10 mt-3 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface-sunken px-3 py-1 text-scale-xs font-weight-semibold text-inverse opacity-0 shadow-elevation-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 lg:left-full lg:top-1/2 lg:ml-3 lg:mt-0 lg:-translate-y-1/2 lg:translate-x-0 lg:shadow-elevation-xl"
    >
      {label}
    </span>
  );
}

function OverlayNavbar({ isPathActive, onExitFullscreen }: { isPathActive: PathPredicate; onExitFullscreen?: () => void }) {
  const containerClasses =
    'rounded-3xl border border-default bg-surface-sunken-glass px-5 py-4 text-inverse shadow-elevation-lg backdrop-blur';

  const tabGroupClasses =
    'inline-flex items-center justify-start gap-1 rounded-full border border-default bg-surface-sunken-glass p-1';

  const getTabClasses = (isActive: boolean) => {
    if (isActive) {
      return 'rounded-full px-5 py-2 text-scale-sm font-weight-semibold text-on-accent bg-accent shadow-accent-soft ring-1 ring-inset ring-accent';
    }

    return 'rounded-full px-5 py-2 text-scale-sm font-weight-semibold text-secondary hover:bg-surface-sunken-glass hover:text-inverse';
  };

  return (
    <nav className={`flex flex-col gap-4 md:flex-row md:items-center md:justify-between ${containerClasses}`} aria-label="Primary">
      <div className="flex flex-col gap-1">
        <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.4em] text-accent-soft">Osiris</span>
        <span className="text-scale-lg font-weight-semibold">AppHub</span>
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
                className={`${getTabClasses(isActive)} transition-colors transition-shadow duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
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
            className="inline-flex items-center gap-2 rounded-full border border-default bg-surface-sunken-glass px-4 py-2 text-scale-sm font-weight-semibold text-inverse transition-colors hover:bg-surface-sunken-glass focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:self-stretch"
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

function EventsIcon({ className }: IconProps) {
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
    >
      <path d="M5 15v2m4-8v12m4-6v6m4-14v14" />
      <path d="M3 19h18" strokeLinejoin="round" />
    </svg>
  );
}

function ObservatoryIcon({ className }: IconProps) {
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
      <path d="M4 10a8 8 0 0 1 16 0" />
      <path d="M12 2v8l6 6" />
      <path d="M6 22h12" />
      <path d="M9 18h6" />
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

function TopologyIcon({ className }: IconProps) {
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
      <circle cx="12" cy="12" r="2.8" />
      <circle cx="6.5" cy="6.5" r="2.1" />
      <circle cx="17.5" cy="6.5" r="2.1" />
      <circle cx="7.5" cy="17.5" r="2.1" />
      <circle cx="16.5" cy="17.5" r="2.1" />
      <path d="M9.2 9.2 10.7 10.7" />
      <path d="m14.8 9.2-1.5 1.5" />
      <path d="m9.8 14.8 1.3-1.3" />
      <path d="m14.2 14.8-1.3-1.3" />
      <path d="M6.5 6.5 5 5" />
      <path d="M17.5 6.5 19 5" />
      <path d="m7.5 17.5-1.8 1.5" />
      <path d="m16.5 17.5 1.8 1.5" />
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
