import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAnalytics } from '../utils/useAnalytics';
import { ROUTE_PATHS } from './paths';

type LegacyImportRedirectProps = {
  from: string;
};

export default function LegacyImportRedirect({ from }: LegacyImportRedirectProps) {
  const analytics = useAnalytics();
  const warnedRef = useRef(false);

  useEffect(() => {
    if (warnedRef.current) {
      return;
    }
    warnedRef.current = true;
    console.warn(`AppHub: Deprecated ${from} route detected. Redirecting to ${ROUTE_PATHS.import}.`);
    analytics.trackEvent('navigation_legacy_redirect', { from, to: ROUTE_PATHS.import });
  }, [analytics, from]);

  return <Navigate to={ROUTE_PATHS.import} replace />;
}
