import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { ROUTE_PATHS } from '../routes/paths';
import {
  SEGMENTED_BUTTON_ACTIVE,
  SEGMENTED_BUTTON_BASE,
  SEGMENTED_BUTTON_INACTIVE,
  SEGMENTED_GROUP
} from './timestoreTokens';

const NAV_ITEMS = [
  { key: 'datasets', label: 'Datasets', path: ROUTE_PATHS.servicesTimestoreDatasets },
  { key: 'streaming', label: 'Streaming', path: ROUTE_PATHS.servicesTimestoreStreaming },
  { key: 'sql', label: 'SQL Editor', path: ROUTE_PATHS.servicesTimestoreSql }
] as const;

const getTabClasses = (isActive: boolean): string =>
  `${SEGMENTED_BUTTON_BASE} px-4 py-2 text-scale-sm ${
    isActive ? SEGMENTED_BUTTON_ACTIVE : SEGMENTED_BUTTON_INACTIVE
  }`;

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
        className={`${SEGMENTED_GROUP} inline-flex flex-wrap items-center self-start`}
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
