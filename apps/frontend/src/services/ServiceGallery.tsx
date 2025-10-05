import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config';
import { useAuth } from '../auth/useAuth';
import { normalizePreviewUrl } from '../utils/url';
import { formatFetchError } from '../core/utils';
import { usePreviewLayout } from '../settings/previewLayoutContext';
import { Spinner } from '../components';
import type { ModuleServiceRuntimeConfig, ServiceSummary } from './types';
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
import { listServices } from '../core/api';

const REFRESH_INTERVAL_MS = 15000;
const STATUS_ORDER = ['healthy', 'degraded', 'unknown', 'unreachable'] as const;
const STATUS_PRIORITY = STATUS_ORDER.reduce<Record<string, number>>((acc, status, index) => {
  acc[status] = index;
  return acc;
}, {});
const UNKNOWN_STATUS_PRIORITY = STATUS_ORDER.length;
const EMPTY_SERVICES: ServiceSummary[] = [];
const HIDDEN_OVERVIEW_SERVICE_IDENTIFIERS = new Set(['timestore', 'filestore', 'metastore']);

function toModuleServiceConfig(config: unknown): ModuleServiceRuntimeConfig | null {
  if (!config || typeof config !== 'object') {
    return null;
  }
  return config as ModuleServiceRuntimeConfig;
}

function buildPreviewUrl(baseUrl: string | null | undefined, previewPath: string | null | undefined) {
  if (!baseUrl) {
    return null;
  }
  if (!previewPath) {
    return baseUrl;
  }
  try {
    const url = new URL(baseUrl);
    if (previewPath.startsWith('/')) {
      url.pathname = previewPath;
    } else {
      const existing = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
      url.pathname = `${existing}${previewPath}`;
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

function isServiceHiddenFromOverview(service: ServiceSummary) {
  const slug = service.slug.toLowerCase();
  if (HIDDEN_OVERVIEW_SERVICE_IDENTIFIERS.has(slug)) {
    return true;
  }
  const kind = service.kind ? service.kind.toLowerCase() : null;
  if (kind && HIDDEN_OVERVIEW_SERVICE_IDENTIFIERS.has(kind)) {
    return true;
  }
  return false;
}

function extractRuntimeUrl(service: ServiceSummary): string | null {
  const runtime = service.metadata?.runtime ?? null;
  const moduleConfig = toModuleServiceConfig(service.metadata?.config);
  const registrationPreviewPath = moduleConfig?.registration?.ui?.previewPath ?? moduleConfig?.registration?.basePath;
  const preferredBaseUrl = moduleConfig?.runtime?.baseUrl ?? runtime?.previewUrl ?? runtime?.baseUrl ?? service.baseUrl;
  const preferred = buildPreviewUrl(preferredBaseUrl, registrationPreviewPath ?? undefined);
  const candidates = [preferred, runtime?.previewUrl, runtime?.instanceUrl, runtime?.baseUrl, service.baseUrl];
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
  const moduleConfig = toModuleServiceConfig(service.metadata?.config);
  const linkedBuilds = service.metadata?.linkedApps ?? manifest?.apps ?? null;
  const manifestSourceLabel = manifest?.source ?? (manifest?.sources?.[0] ?? 'manifest import');
  const runtimeLabel =
    runtime?.repositoryId ?? moduleConfig?.module?.id ?? runtime?.baseUrl ?? 'not linked';
  const moduleTags = moduleConfig?.registration?.tags ?? [];
  const previewPath = moduleConfig?.registration?.ui?.previewPath ?? moduleConfig?.registration?.basePath;

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
              <dt>Runtime Build</dt>
              <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>{runtimeLabel}</dd>
            </div>
            {previewPath ? (
              <div className="flex flex-col gap-1">
                <dt>Preview Path</dt>
                <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>{previewPath}</dd>
              </div>
            ) : null}
            {moduleTags && moduleTags.length > 0 ? (
              <div className="flex flex-col gap-1">
                <dt>Tags</dt>
                <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>{moduleTags.join(', ')}</dd>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <dt>Linked Builds</dt>
              <dd className={SERVICE_PREVIEW_DETAIL_VALUE_CLASSES}>
                {linkedBuilds && linkedBuilds.length > 0 ? linkedBuilds.join(', ') : 'none'}
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
  const { activeToken: authToken } = useAuth();
  const { width } = usePreviewLayout();
  const fetchServices = useCallback(
    async ({
      signal
    }: {
      authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
      signal: AbortSignal;
    }) => {
      if (!authToken) {
        return [];
      }
      const services = await listServices(authToken, { signal });
      return services;
    },
    [authToken]
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
      .filter((service) => !isServiceHiddenFromOverview(service))
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
