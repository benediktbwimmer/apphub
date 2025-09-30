import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { ROUTE_PATHS } from '../routes/paths';
import {
  SERVICE_HEADER_LABEL_CLASSES,
  SERVICE_HEADER_SUBTITLE_CLASSES,
  SERVICE_HEADER_TITLE_CLASSES,
  SERVICE_PAGE_CONTAINER_CLASSES,
  SERVICE_TAB_ACTIVE_CLASSES,
  SERVICE_TAB_CONTAINER_CLASSES,
  SERVICE_TAB_INACTIVE_CLASSES
} from './serviceTokens';

const NAV_ITEMS: ReadonlyArray<{ key: string; label: string; path: string; end?: boolean }> = [
  { key: 'overview', label: 'Overview', path: ROUTE_PATHS.servicesOverview, end: true },
  { key: 'timestore', label: 'Timestore', path: ROUTE_PATHS.servicesTimestore },
  { key: 'filestore', label: 'Filestore', path: ROUTE_PATHS.servicesFilestore },
  { key: 'metastore', label: 'Metastore', path: ROUTE_PATHS.servicesMetastore }
];

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
      <header className={SERVICE_PAGE_CONTAINER_CLASSES}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className={SERVICE_HEADER_LABEL_CLASSES}>Services</span>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className={SERVICE_HEADER_TITLE_CLASSES}
            >
              Service Control Hub
            </h1>
            <p className={SERVICE_HEADER_SUBTITLE_CLASSES}>
              Switch between service surfaces to monitor and operate the platform.
            </p>
          </div>
          <nav
            aria-label="Service sections"
            className={SERVICE_TAB_CONTAINER_CLASSES}
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.end ?? false}
                className={({ isActive }) => (isActive ? SERVICE_TAB_ACTIVE_CLASSES : SERVICE_TAB_INACTIVE_CLASSES)}
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
