import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LegacyImportRedirect from '../LegacyImportRedirect';
import { ROUTE_PATHS } from '../paths';

describe('LegacyImportRedirect', () => {
  const events: Array<{ event: string; payload: unknown }> = [];

  const handleAnalyticsEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ event: string; payload: unknown }>).detail;
    if (detail) {
      events.push({ event: detail.event, payload: detail.payload });
    }
  };

  beforeEach(() => {
    events.length = 0;
    window.addEventListener('analytics:event', handleAnalyticsEvent);
  });

  afterEach(() => {
    window.removeEventListener('analytics:event', handleAnalyticsEvent);
  });

  it('redirects legacy paths to the import workspace with warnings and analytics', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/submit']}>
        <Routes>
          <Route path="/submit" element={<LegacyImportRedirect from="/submit" />} />
          <Route path={ROUTE_PATHS.import} element={<div>Import Destination</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Import Destination')).toBeInTheDocument());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Deprecated /submit route detected. Redirecting to ${ROUTE_PATHS.import}`)
    );
    expect(events.some((entry) => entry.event === 'navigation_legacy_redirect')).toBe(true);

    warnSpy.mockRestore();
  });
});
