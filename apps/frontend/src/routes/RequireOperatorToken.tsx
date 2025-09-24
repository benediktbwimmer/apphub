import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { useAnalytics } from '../utils/useAnalytics';
import { ROUTE_PATHS } from './paths';

export function RequireOperatorToken({ children }: PropsWithChildren<unknown>) {
  const { identity, identityLoading } = useAuth();
  const location = useLocation();
  const analytics = useAnalytics();
  const warnedPath = useRef<string | null>(null);
  const hasIdentity = Boolean(identity);

  useEffect(() => {
    if (identityLoading || hasIdentity) {
      warnedPath.current = null;
      return;
    }
    if (warnedPath.current === location.pathname) {
      return;
    }
    warnedPath.current = location.pathname;
    console.warn(
      `AppHub: Operator token required to access ${location.pathname}. Redirecting to ${ROUTE_PATHS.settingsApiAccess}.`
    );
    analytics.trackEvent('operator_route_guard_blocked', {
      from: location.pathname,
      to: ROUTE_PATHS.settingsApiAccess
    });
  }, [analytics, hasIdentity, identityLoading, location.pathname]);

  if (!identity && !identityLoading) {
    return <Navigate to={ROUTE_PATHS.settingsApiAccess} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
