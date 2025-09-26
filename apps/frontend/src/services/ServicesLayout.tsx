import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { ROUTE_PATHS } from '../routes/paths';

const NAV_ITEMS: ReadonlyArray<{ key: string; label: string; path: string; end?: boolean }> = [
  { key: 'overview', label: 'Overview', path: ROUTE_PATHS.servicesOverview, end: true },
  { key: 'timestore', label: 'Timestore', path: ROUTE_PATHS.servicesTimestore },
  { key: 'filestore', label: 'Filestore', path: ROUTE_PATHS.servicesFilestore },
  { key: 'metastore', label: 'Metastore', path: ROUTE_PATHS.servicesMetastore }
];

function getTabClasses(isActive: boolean): string {
  if (isActive) {
    return 'rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:bg-violet-500';
  }
  return 'rounded-full px-5 py-2 text-sm font-semibold text-slate-600 transition-colors duration-200 hover:bg-violet-600/10 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:text-slate-300 dark:hover:text-slate-100';
}

export default function ServicesLayout() {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    const node = headingRef.current;
    if (!node) {
      return;
    }
    // Delay focus slightly so screen readers announce context after navigation.
    const timer = setTimeout(() => {
      node.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [location.pathname]);

  return (
    <section className="flex flex-col gap-6">
      <header className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.35em] text-violet-600 dark:text-violet-300">Services</span>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold text-slate-900 outline-none transition-shadow dark:text-slate-100"
            >
              Service Control Hub
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Switch between service surfaces to monitor and operate the platform.
            </p>
          </div>
          <nav
            aria-label="Service sections"
            className="inline-flex flex-wrap items-center gap-2 rounded-full border border-slate-200/70 bg-slate-100/80 p-1 dark:border-slate-700/70 dark:bg-slate-800/70"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.end ?? false}
                className={({ isActive }) => getTabClasses(isActive)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <Outlet />
    </section>
  );
}
