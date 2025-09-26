import { useCallback, useMemo, useRef } from 'react';
import { API_BASE_URL } from '../config';
import { normalizePreviewUrl } from '../utils/url';
import { formatFetchError } from '../catalog/utils';
import { usePreviewLayout } from '../settings/previewLayoutContext';
import { Spinner } from '../components';
import type { ServiceSummary, ServicesResponse } from './types';
import { usePollingResource } from '../hooks/usePollingResource';

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
    <article
      ref={containerRef}
      className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-950/60 shadow-lg shadow-slate-900/30 dark:border-slate-700/60 dark:bg-slate-900/80"
      aria-label={displayName}
    >
      <div className="absolute right-3 top-3 z-10">
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white shadow focus:outline-none focus:ring-2 focus:ring-slate-100/80 focus:ring-offset-2 focus:ring-offset-slate-900/80 dark:bg-slate-800/90"
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
      <div className="border-t border-slate-200/60 bg-slate-950/70 px-5 py-4 text-left text-sm text-slate-100 dark:border-slate-700/50 dark:bg-slate-900/80">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-300">Service</span>
            <h3 className="text-base font-semibold text-white">{displayName}</h3>
            <p className="text-xs text-slate-300">
              {service.kind ? `${service.kind} • ` : ''}base URL: {service.baseUrl ?? 'n/a'}
            </p>
          </div>
          <dl className="grid gap-3 text-[11px] uppercase tracking-[0.2em] text-slate-400 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt>Manifest Source</dt>
              <dd className="text-[12px] font-medium normal-case text-slate-100">
                {manifestSourceLabel}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt>Runtime App</dt>
              <dd className="text-[12px] font-medium normal-case text-slate-100">{runtimeLabel}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt>Linked Apps</dt>
              <dd className="text-[12px] font-medium normal-case text-slate-100">
                {linkedApps && linkedApps.length > 0 ? linkedApps.join(', ') : 'none'}
              </dd>
            </div>
          </dl>
          {service.metadata?.notes && (
            <p className="text-xs text-slate-300">{service.metadata.notes}</p>
          )}
        </div>
      </div>
      <span className="sr-only">{displayName}</span>
    </article>
  );
}

export default function ServiceGallery() {
  const { width } = usePreviewLayout();
  const {
    data: servicesData,
    loading,
    error,
    refetch
  } = usePollingResource<ServiceSummary[]>({
    intervalMs: REFRESH_INTERVAL_MS,
    fetcher: async ({ authorizedFetch, signal }) => {
      const response = await authorizedFetch(`${API_BASE_URL}/services`, { signal });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      const payload = (await response.json()) as ServicesResponse;
      return hasServiceData(payload) ? payload.data : [];
    }
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
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-4 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70 sm:p-6">
        {errorMessage ? (
          <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-5 py-4 text-sm font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            <div className="flex items-center justify-between gap-4">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => refetch()}
                className="rounded-full border border-rose-400/60 px-3 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 dark:border-rose-400/40 dark:text-rose-200"
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            <Spinner label="Loading services" size="sm" />
          </div>
        ) : previewableServices.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            No services with previews available yet.
          </div>
        ) : (
          <div className="grid gap-4 sm:gap-6" style={{ gridTemplateColumns }}>
            {previewableServices.map(({ service, embedUrl }) => (
              <ServicePreviewCard key={service.id} service={service} embedUrl={embedUrl} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
