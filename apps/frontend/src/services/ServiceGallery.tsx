import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config';
import { normalizePreviewUrl } from '../utils/url';
import { formatFetchError } from '../core/utils';
import { usePreviewLayout } from '../settings/previewLayoutContext';
import { Spinner } from '../components';
import type { ServiceSummary, ServicesResponse } from './types';
import { usePollingResource } from '../hooks/usePollingResource';
import {
  SERVICE_ALERT_CLASSES,
  SERVICE_EMPTY_STATE_CLASSES,
  SERVICE_GRID_GAP_CLASSES,
  SERVICE_LOADING_CARD_CLASSES,
  SERVICE_PAGE_CONTAINER_CLASSES,
  SERVICE_PREVIEW_CARD_CLASSES,
  SERVICE_PREVIEW_CHIP_LABEL_CLASSES,
  SERVICE_PREVIEW_DETAIL_VALUE_CLASSES,
  SERVICE_PREVIEW_DETAILS_CLASSES,
  SERVICE_PREVIEW_FULLSCREEN_BUTTON_CLASSES,
  SERVICE_PREVIEW_METADATA_CLASSES,
  SERVICE_PREVIEW_NOTES_CLASSES,
  SERVICE_PREVIEW_SUBTITLE_CLASSES,
  SERVICE_PREVIEW_TITLE_CLASSES
} from './serviceTokens';
import { getStatusToneClasses } from '../theme/statusTokens';

const REFRESH_INTERVAL_MS = 15000;
const STATUS_ORDER = ['healthy', 'degraded', 'unknown', 'unreachable'] as const;
const STATUS_PRIORITY = STATUS_ORDER.reduce<Record<string, number>>((acc, status, index) => {
  acc[status] = index;
  return acc;
}, {});
const UNKNOWN_STATUS_PRIORITY = STATUS_ORDER.length;
const EMPTY_SERVICES: ServiceSummary[] = [];

function hasServiceData(payload: ServicesResponse): payload is { data: ServiceSummary[] } {
  return Array.isArray((payload as { data?: unknown }).data);
}

function extractRuntimeUrl(service: ServiceSummary): string | null {
  const runtime = service.metadata?.runtime ?? null;
  const candidates = [runtime?.previewUrl, runtime?.instanceUrl, runtime?.baseUrl, service.baseUrl];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

type ServicePreviewCardProps = {
  service: ServiceSummary;
  embedUrl: string;
};

function ServicePreviewCard({ service, embedUrl }: ServicePreviewCardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { height } = usePreviewLayout();
  const displayName = service.displayName ?? service.slug;
  const manifest = service.metadata?.manifest ?? null;
  const runtime = service.metadata?.runtime ?? null;
  const linkedApps = service.metadata?.linkedApps ?? manifest?.apps ?? null;
  const manifestSourceLabel = manifest?.source ?? (manifest?.sources?.[0] ?? 'manifest import');
  const runtimeLabel = runtime?.repositoryId ?? runtime?.baseUrl ?? 'not linked';

  useEffect(() => {
    const handleFullscreenChange = () => {
      const container = containerRef.current;
      setIsFullscreen(container !== null && document.fullscreenElement === container);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const exitFullscreen = document.exitFullscreen?.bind(document);
    if (document.fullscreenElement === container) {
      await exitFullscreen?.();
      return;
    }

    await container.requestFullscreen?.();
  }, []);

  return (
    <article ref={containerRef} className={SERVICE_PREVIEW_CARD_CLASSES} aria-label={displayName}>
      <div className="absolute right-3 top-3 z-10">
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          className={SERVICE_PREVIEW_FULLSCREEN_BUTTON_CLASSES}
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <div style={{ height: isFullscreen ? '100%' : `${height}px` }}>
        <iframe
          src={embedUrl}
          title={displayName}
          loading="lazy"
          allow="autoplay; fullscreen; clipboard-read; clipboard-write"
          allowFullScreen
          sandbox="allow-scripts"
          className="h-full w-full border-0"
        />
      </div>
      <div className={SERVICE_PREVIEW_METADATA_CLASSES}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col">
            <span className={SERVICE_PREVIEW_CHIP_LABEL_CLASSES}>Service</span>
            <h3 className={SERVICE_PREVIEW_TITLE_CLASSES}>{displayName}</h3>
            <p className={SERVICE_PREVIEW_SUBTITLE_CLASSES}>
              {service.kind ? `${service.kind} • ` : ''}base URL: {service.baseUrl ?? 'n/a'}
            </p>
          </div>
          <dl className={SERVICE_PREVIEW_DETAILS_CLASSES}>
            <div className="flex flex-col gap-1">
              <dt>Manifest Source</dt>
              <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>
                {manifestSourceLabel}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt>Runtime App</dt>
              <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>{runtimeLabel}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt>Linked Apps</dt>
              <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>
                {linkedApps && linkedApps.length > 0 ? linkedApps.join(', ') : 'none'}
              </dd>
            </div>
          </dl>
          {service.metadata?.notes && <p className={SERVICE_PREVIEW_NOTES_CLASSES}>{service.metadata.notes}</p>}
        </div>
      </div>
      <span className="sr-only">{displayName}</span>
    </article>
  );
}

export default function ServiceGallery() {
  const { width } = usePreviewLayout();
  const fetchServices = useCallback(
    async ({
      authorizedFetch,
      signal
    }: {
      authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
      signal: AbortSignal;
    }) => {
      const response = await authorizedFetch(`${API_BASE_URL}/services`, { signal });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const payload = (await response.json()) as ServicesResponse;
      return hasServiceData(payload) ? payload.data : [];
    },
    []
  );

  const {
    data: servicesData,
    loading,
    error,
    refetch
  } = usePollingResource<ServiceSummary[]>({
    intervalMs: REFRESH_INTERVAL_MS,
    fetcher: fetchServices
  });
  const services = servicesData ?? EMPTY_SERVICES;
  const errorMessage = error
    ? formatFetchError(error, 'Failed to load services', API_BASE_URL)
    : null;

  const previewableServices = useMemo(() => {
    const entries = services
      .map((service) => {
        const embedUrl = normalizePreviewUrl(extractRuntimeUrl(service));
        if (!embedUrl) {
          return null;
        }
        return { service, embedUrl };
      })
      .filter(
        (entry): entry is { service: ServiceSummary; embedUrl: string } => entry !== null
      );

    entries.sort((a, b) => {
      // Prioritize healthy services so working previews appear first.
      const priorityA = STATUS_PRIORITY[a.service.status] ?? UNKNOWN_STATUS_PRIORITY;
      const priorityB = STATUS_PRIORITY[b.service.status] ?? UNKNOWN_STATUS_PRIORITY;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      const nameA = a.service.displayName ?? a.service.slug;
      const nameB = b.service.displayName ?? b.service.slug;
      return nameA.localeCompare(nameB);
    });

    return entries;
  }, [services]);

  const gridTemplateColumns = useMemo(() => {
    const clampedWidth = Math.round(width);
    return `repeat(auto-fit, minmax(${clampedWidth}px, 1fr))`;
  }, [width]);

  return (
    <section className="flex flex-col gap-6">
      <div className={SERVICE_PAGE_CONTAINER_CLASSES}>
        {errorMessage ? (
          <div className={classNames(SERVICE_ALERT_CLASSES, getStatusToneClasses('danger'))}>
            <div className="flex items-center justify-between gap-4">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-full border border-status-danger bg-status-danger-soft px-3 py-1 text-scale-xs font-weight-semibold text-status-danger transition-colors hover:bg-status-danger-soft/80"
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className={SERVICE_LOADING_CARD_CLASSES}>
            <Spinner label="Loading services" size="sm" />
          </div>
        ) : previewableServices.length === 0 ? (
          <div className={SERVICE_EMPTY_STATE_CLASSES}>
            No services with previews available yet.
          </div>
        ) : (
          <div className={SERVICE_GRID_GAP_CLASSES} style={{ gridTemplateColumns }}>
            {previewableServices.map(({ service, embedUrl }) => (
              <ServicePreviewCard key={service.id} service={service} embedUrl={embedUrl} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
