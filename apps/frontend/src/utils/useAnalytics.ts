import { useCallback } from 'react';

type AnalyticsPayload = Record<string, unknown>;

type AnalyticsApi = {
  trackEvent: (event: string, payload?: AnalyticsPayload) => void;
};

export function useAnalytics(): AnalyticsApi {
  const trackEvent = useCallback((event: string, payload?: AnalyticsPayload) => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(
          new CustomEvent('analytics:event', {
            detail: { event, payload }
          })
        );
      }
      if (import.meta.env?.DEV) {
        console.debug('[analytics]', event, payload ?? {});
      }
    } catch {
      // Silently ignore analytics dispatch errors.
    }
  }, []);

  return { trackEvent };
}
