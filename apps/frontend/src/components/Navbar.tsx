import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PRIMARY_NAV_ITEMS, type PrimaryNavKey } from '../routes/paths';
import { useModuleScope } from '../modules/ModuleScopeContext';
import type { ModuleSummary } from '../modules/types';

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
  observability: ObservabilityIcon,
  core: BuildsIcon,
  events: EventsIcon,
  assets: AssetsIcon,
  services: ServicesIcon,
  runs: RunsIcon,
  jobs: JobsIcon,
  workflows: WorkflowsIcon,
  topology: TopologyIcon,
  schedules: SchedulesIcon,
  settings: SettingsIcon
};

export default function Navbar({ variant = 'default', onExitFullscreen }: NavbarProps) {
  const location = useLocation();
  const moduleScope = useModuleScope();
  const isOverlay = variant === 'overlay';

  const activePath = useMemo(() => {
    const stripped = moduleScope.stripModulePrefix(location.pathname).replace(/\/$/, '');
    return stripped || '/';
  }, [location.pathname, moduleScope]);

  const isPathActive = useCallback<PathPredicate>(
    (path) => {
      const target = moduleScope.stripModulePrefix(moduleScope.buildModulePath(path));
      if (target === '/') {
        return activePath === '/';
      }
      return activePath === target || activePath.startsWith(`${target}/`);
    },
    [activePath, moduleScope]
  );

  if (isOverlay) {
    return (
      <OverlayNavbar
        isPathActive={isPathActive}
        onExitFullscreen={onExitFullscreen}
        moduleScope={moduleScope}
      />
    );
  }

  return <SidebarNavbar isPathActive={isPathActive} moduleScope={moduleScope} />;
}

function SidebarNavbar({
  isPathActive,
  moduleScope
}: {
  isPathActive: PathPredicate;
  moduleScope: ReturnType<typeof useModuleScope>;
}) {
  return (
    <aside className="flex-shrink-0 lg:sticky lg:top-10 lg:self-start">
      <div className="flex h-full max-h-[calc(100vh-5rem)] flex-col items-center gap-6 rounded-3xl border border-subtle bg-surface-glass px-4 py-5 text-primary shadow-elevation-lg backdrop-blur-md">
        <div className="flex flex-col items-center text-center">
          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.6em] text-accent-soft">
            Osiris
          </span>
          <span className="text-scale-sm font-weight-semibold text-primary">AppHub</span>
        </div>
        <ModuleSwitcher variant="sidebar" moduleScope={moduleScope} />
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
                to={moduleScope.buildModulePath(item.path)}
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

function OverlayNavbar({
  isPathActive,
  onExitFullscreen,
  moduleScope
}: {
  isPathActive: PathPredicate;
  onExitFullscreen?: () => void;
  moduleScope: ReturnType<typeof useModuleScope>;
}) {
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
        <ModuleSwitcher variant="overlay" moduleScope={moduleScope} />
        <div className={tabGroupClasses} role="tablist" aria-label="Pages">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const isActive = isPathActive(item.path);
            return (
              <Link
                key={item.key}
                to={moduleScope.buildModulePath(item.path)}
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

function ModuleSwitcher({
  variant,
  moduleScope
}: {
  variant: 'sidebar' | 'overlay';
  moduleScope: ReturnType<typeof useModuleScope>;
}) {
  const { moduleId, moduleVersion, modules, loadingModules, modulesError, setModuleId } = moduleScope;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const previousModuleIdRef = useRef<string | null>(moduleId);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);

  const handleToggle = useCallback(() => {
    if (loadingModules) {
      return;
    }
    setOpen((value) => !value);
  }, [loadingModules]);

  const closePopover = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointer(event: MouseEvent) {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return;
      }
      closePopover();
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closePopover();
        triggerRef.current?.focus();
      }
    }

    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, closePopover]);

  useEffect(() => {
    if (previousModuleIdRef.current !== moduleId) {
      previousModuleIdRef.current = moduleId;
      closePopover();
    }
  }, [moduleId, closePopover]);

  useEffect(() => {
    if (!(open && variant === 'sidebar')) {
      setTriggerRect(null);
      return;
    }
    const updateRect = () => {
      if (!triggerRef.current) {
        setTriggerRect(null);
        return;
      }
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [open, variant]);

  const activeModule = useMemo(() => {
    if (!moduleId) {
      return null;
    }
    return modules.find((entry) => entry.id === moduleId) ?? null;
  }, [moduleId, modules]);

  const handleSelect = useCallback(
    (nextModuleId: string | null) => {
      setModuleId(nextModuleId);
    },
    [setModuleId]
  );

  const isModuleScoped = Boolean(moduleId);
  const isPopoverVisible = open;

  return (
    <div className="relative">
      <button
        type="button"
        ref={triggerRef}
        className={getModuleTriggerClasses(variant, isModuleScoped, open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Module scope"
        onClick={handleToggle}
        disabled={loadingModules}
      >
        <ModuleScopeIcon className={variant === 'sidebar' ? 'h-5 w-5' : 'h-4 w-4'} />
        {variant === 'overlay' && (
          <span className="truncate text-scale-sm font-weight-medium">
            {moduleId ? activeModule?.displayName ?? moduleId : 'All modules'}
          </span>
        )}
        {variant === 'overlay' && (
          <ChevronIcon
            className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        )}
        {variant === 'sidebar' && <Tooltip label="Module scope" />}
      </button>
      {isPopoverVisible && (
        <ModuleScopePopover
          ref={popoverRef}
          variant={variant}
          anchorRect={triggerRect}
          modules={modules}
          moduleId={moduleId}
          moduleVersion={moduleVersion}
          loadingModules={loadingModules}
          modulesError={modulesError}
          onSelect={handleSelect}
          onDismiss={closePopover}
        />
      )}
      {loadingModules && variant === 'overlay' && (
        <span className="text-scale-2xs text-muted">Loading modules…</span>
      )}
    </div>
  );
}

type ModuleScopePopoverProps = {
  variant: 'sidebar' | 'overlay';
  anchorRect: DOMRect | null;
  modules: ModuleSummary[];
  moduleId: string | null;
  moduleVersion: string | null;
  loadingModules: boolean;
  modulesError: string | null;
  onSelect: (moduleId: string | null) => void;
  onDismiss: () => void;
};

const ModuleScopePopover = forwardRef<HTMLDivElement, ModuleScopePopoverProps>(
  function ModuleScopePopover(
    { variant, anchorRect, modules, moduleId, moduleVersion, loadingModules, modulesError, onSelect, onDismiss },
    ref
  ) {
    const activeModule = moduleId ? modules.find((entry) => entry.id === moduleId) ?? null : null;
    const renderOptions = () => (
      <div role="menu" aria-orientation="vertical">
        {loadingModules && (
          <p className="px-3 text-scale-xs text-muted">Loading modules…</p>
        )}
        <ModuleScopeOption
          variant={variant}
          label="All modules"
          description="Show data across every module."
          isActive={!moduleId}
          onSelect={() => {
            onSelect(null);
            if (variant === 'overlay') {
              onDismiss();
            }
          }}
        />
        {modulesError && (
          <p className="mt-3 px-3 text-scale-xs text-danger" role="status">
            {modulesError}
          </p>
        )}
        {modules.map((module) => (
          <ModuleScopeOption
            key={module.id}
            variant={variant}
            label={module.displayName ?? module.id}
            description={module.description ?? undefined}
            meta={module.latestVersion ? `Version ${module.latestVersion}` : undefined}
            isActive={moduleId === module.id}
            onSelect={() => {
              onSelect(module.id);
              if (variant === 'overlay') {
                onDismiss();
              }
            }}
          />
        ))}
        {modules.length === 0 && !modulesError && (
          <p className="mt-3 text-scale-xs text-muted">No modules available.</p>
        )}
      </div>
    );

    if (variant === 'overlay') {
      const overlayContent = (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center px-4 py-16">
          <div
            className="absolute inset-0 bg-surface-sunken/60 backdrop-blur-sm"
            aria-hidden="true"
            onClick={onDismiss}
          />
          <div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Select module scope"
            className="relative z-10 w-full max-w-lg rounded-3xl border border-subtle bg-surface-contrast p-6 text-left shadow-elevation-2xl"
            style={{ backgroundColor: 'var(--color-surface-contrast, #05060f)' }}
          >
            <header className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-scale-sm font-weight-semibold text-primary">Choose a module</h2>
                <p className="text-scale-xs text-secondary">
                  Filter the workspace by a specific module or view everything across AppHub.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border border-transparent bg-surface-muted p-2 text-muted transition-colors hover:border-accent-soft hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={onDismiss}
                aria-label="Close module selector"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[60vh] overflow-y-auto pr-2">
              {renderOptions()}
            </div>
          </div>
        </div>
      );

      if (typeof document !== 'undefined') {
        return createPortal(overlayContent, document.body);
      }

      return overlayContent;
    }

    if (!anchorRect) {
      return null;
    }
    const sidebarContent = (
      <div
        ref={ref}
        role="dialog"
        aria-label="Module scope options"
        className="fixed z-[2147483647] w-72 max-w-[18rem] rounded-2xl border border-subtle bg-surface-contrast p-4 text-left shadow-elevation-2xl"
        style={{
          backgroundColor: 'var(--color-surface-contrast, #05060f)',
          top: anchorRect.top + anchorRect.height / 2,
          left: anchorRect.right + 16,
          transform: 'translateY(-50%)'
        }}
      >
        <div className="flex flex-col gap-1 border-b border-subtle pb-3">
          <span className="text-scale-2xs font-weight-semibold uppercase tracking-[0.3em] text-muted">
            Module scope
          </span>
          <span className="text-scale-sm font-weight-semibold text-primary">
            {moduleId ? activeModule?.displayName ?? moduleId : 'All modules'}
          </span>
          {moduleId && moduleVersion && (
            <span className="text-scale-2xs text-muted">Version {moduleVersion}</span>
          )}
          {activeModule?.description && (
            <p className="text-scale-xs text-secondary">{activeModule.description}</p>
          )}
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto pr-1">{renderOptions()}</div>
      </div>
    );
    if (typeof document !== 'undefined') {
      return createPortal(sidebarContent, document.body);
    }
    return sidebarContent;
  }
);

type ModuleScopeOptionProps = {
  label: string;
  description?: string;
  meta?: string;
  isActive: boolean;
  onSelect: () => void;
  variant: 'sidebar' | 'overlay';
};

function ModuleScopeOption({ label, description, meta, isActive, onSelect, variant }: ModuleScopeOptionProps) {
  const activeClasses =
    variant === 'overlay'
      ? 'bg-accent-soft/50 text-primary ring-1 ring-accent'
      : 'bg-accent-soft text-primary ring-1 ring-accent';
  const baseClasses =
    'mt-2 w-full rounded-xl border border-transparent px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isActive}
      onClick={onSelect}
      className={`${baseClasses} ${
        isActive ? activeClasses : 'text-primary hover:border-accent-soft hover:bg-surface-muted'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="block text-scale-sm font-weight-semibold">{label}</span>
        {isActive && <CheckIcon className="h-4 w-4 text-accent" />}
      </div>
      {meta && <span className="block text-scale-2xs text-muted">{meta}</span>}
      {description && <p className="mt-1 text-scale-xs text-secondary">{description}</p>}
    </button>
  );
}

function getModuleTriggerClasses(
  variant: 'sidebar' | 'overlay',
  isModuleScoped: boolean,
  open: boolean
): string {
  if (variant === 'sidebar') {
    return getSidebarLinkClasses(isModuleScoped || open);
  }

  const base =
    'group inline-flex max-w-xs items-center gap-2 rounded-full border border-default bg-surface-sunken-glass px-4 py-2 text-scale-sm font-weight-medium text-inverse transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

  if (open || isModuleScoped) {
    return `${base} border-accent text-on-accent bg-accent`;
  }

  return `${base} hover:bg-surface-sunken-glass`;
}

function ModuleScopeIcon({ className }: IconProps) {
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
      <circle cx="12" cy="12" r="5" />
      <path d="M4 12a8 8 0 0 1 8-8" />
      <path d="M12 20a8 8 0 0 0 8-8" />
    </svg>
  );
}

function ChevronIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5 6 7.5l3-3" />
    </svg>
  );
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l6 6M9 3 3 9" />
    </svg>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3.5 8.5 3 3 6-6" />
    </svg>
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

function ObservabilityIcon({ className }: IconProps) {
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
      <path d="M4 18h16" />
      <path d="M6 16l3.2-4 3 3 3.6-4.8L18 13" />
      <circle cx="9.2" cy="12" r="1" />
      <circle cx="12.2" cy="15" r="1" />
      <circle cx="15.8" cy="10.5" r="1" />
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

function BuildsIcon({ className }: IconProps) {
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
