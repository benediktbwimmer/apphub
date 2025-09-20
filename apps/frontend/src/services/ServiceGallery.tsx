import { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../config';
import { normalizePreviewUrl } from '../utils/url';
import { formatFetchError } from '../catalog/utils';

type ServiceSummary = {
  id: string;
  slug: string;
  displayName: string;
  kind: string;
  baseUrl: string;
  status: string;
  statusMessage: string | null;
  capabilities: unknown;
  metadata: unknown;
  lastHealthyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ServicesResponse = {
  data?: ServiceSummary[];
};

const REFRESH_INTERVAL_MS = 15000;
const STATUS_ORDER = ['healthy', 'degraded', 'unknown', 'unreachable'] as const;
const STATUS_PRIORITY = STATUS_ORDER.reduce<Record<string, number>>((acc, status, index) => {
  acc[status] = index;
  return acc;
}, {});
const UNKNOWN_STATUS_PRIORITY = STATUS_ORDER.length;

function extractRuntimeUrl(service: ServiceSummary): string | null {
  const metadata = service.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const runtime = (metadata as Record<string, unknown>).runtime;
    if (runtime && typeof runtime === 'object' && !Array.isArray(runtime)) {
      const runtimeRecord = runtime as Record<string, unknown>;
      const candidates = [runtimeRecord.instanceUrl, runtimeRecord.baseUrl, runtimeRecord.previewUrl];
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return candidate.trim();
        }
      }
    }
  }
  if (typeof service.baseUrl === 'string' && service.baseUrl.trim()) {
    return service.baseUrl.trim();
  }
  return null;
}

export default function ServiceGallery() {
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let timeoutId: number | null = null;
    let controller: AbortController | null = null;
    let initialLoad = true;

    const fetchServices = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

      if (initialLoad) {
        setLoading(true);
      }

      try {
        const response = await fetch(`${API_BASE_URL}/services`, { signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        const payload = (await response.json()) as ServicesResponse;
        if (!mounted) {
          return;
        }
        setServices(Array.isArray(payload.data) ? payload.data : []);
        setError(null);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          return;
        }
        if (!mounted) {
          return;
        }
        setError(formatFetchError(err, 'Failed to load services', API_BASE_URL));
      } finally {
        if (mounted) {
          if (initialLoad) {
            setLoading(false);
            initialLoad = false;
          }
          timeoutId = window.setTimeout(fetchServices, REFRESH_INTERVAL_MS);
        }
      }
    };

    fetchServices();

    return () => {
      mounted = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      controller?.abort();
    };
  }, []);

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
      return a.service.displayName.localeCompare(b.service.displayName);
    });

    return entries;
  }, [services]);

  return (
    <section className="flex flex-col gap-6">
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-4 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md transition-colors dark:border-slate-700/70 dark:bg-slate-900/70 sm:p-6">
        {error ? (
          <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-5 py-4 text-sm font-semibold text-rose-600 shadow-sm dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            Loading services…
          </div>
        ) : previewableServices.length === 0 ? (
          <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 px-5 py-4 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700/70 dark:bg-slate-800/70 dark:text-slate-300">
            No services with previews available yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 xl:grid-cols-3">
            {previewableServices.map(({ service, embedUrl }) => (
              <article
                key={service.id}
                className="overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-950/60 shadow-lg shadow-slate-900/30 transition-transform duration-300 ease-out hover:-translate-y-1 hover:shadow-2xl dark:border-slate-700/60 dark:bg-slate-900/80"
                aria-label={service.displayName}
              >
                <div className="aspect-video">
                  <iframe
                    src={embedUrl ?? undefined}
                    title={service.displayName}
                    loading="lazy"
                    allow="autoplay; fullscreen; clipboard-read; clipboard-write"
                    sandbox="allow-scripts"
                    className="h-full w-full border-0"
                  />
                </div>
                <span className="sr-only">{service.displayName}</span>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
