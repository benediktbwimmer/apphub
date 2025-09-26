import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { ROUTE_PATHS } from '../routes/paths';

const NAV_ITEMS = [
  { key: 'datasets', label: 'Datasets', path: ROUTE_PATHS.servicesTimestoreDatasets },
  { key: 'sql', label: 'SQL Editor', path: ROUTE_PATHS.servicesTimestoreSql }
] as const;

function getTabClasses(isActive: boolean): string {
  if (isActive) {
    return 'rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:bg-slate-100 dark:text-slate-900';
  }
  return 'rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-900/10 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:text-slate-300 dark:hover:text-slate-100';
}

export default function TimestoreLayout() {
  const navRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    const node = navRef.current;
    if (!node) {
      return;
    }
    // Delay focus so announcement happens after navigation settles.
    const timer = setTimeout(() => {
      node.focus();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [location.pathname]);

  return (
    <section className="flex flex-col gap-6">
      <div
        ref={navRef}
        tabIndex={-1}
        aria-label="Timestore sections"
        className="inline-flex flex-wrap items-center gap-2 self-start rounded-full border border-slate-200/70 bg-slate-100/80 p-1 shadow-sm outline-none dark:border-slate-700/70 dark:bg-slate-800/70"
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) => getTabClasses(isActive)}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </section>
  );
}
