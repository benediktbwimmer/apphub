import {
  EventPublisher,
  EventPublisherHandleBase,
  EventPublisherProxyOptions,
  normalizeEventEnvelope,
  normalizeStringValue,
  resolveProxyToken,
  headerHasName,
  validateEventEnvelope
} from './core';

export type EventProxyPublisherOptions = {
  proxyUrl?: string | null;
  proxy?: EventPublisherProxyOptions;
  fetchImpl?: typeof fetch;
};

export function createEventProxyPublisher<TOptions = unknown>(
  options: EventProxyPublisherOptions = {}
): EventPublisherHandleBase<null, TOptions> {
  const configuredProxyUrl = normalizeStringValue(options.proxy?.url);
  const overrideProxyUrl = normalizeStringValue(options.proxyUrl);
  const envProxyUrl = normalizeStringValue(process.env.APPHUB_EVENT_PROXY_URL);
  const proxyUrl = configuredProxyUrl ?? overrideProxyUrl ?? envProxyUrl;

  if (!proxyUrl) {
    throw new Error(
      'Event proxy URL is not configured. Set APPHUB_EVENT_PROXY_URL or provide proxyUrl.'
    );
  }

  const defaultFetch =
    typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined;
  const fetchImpl = options.fetchImpl ?? defaultFetch;

  if (!fetchImpl) {
    throw new Error('Fetch API is not available. Provide fetchImpl when using the HTTP event proxy.');
  }

  let closed = false;

  const publish: EventPublisher<TOptions> = async (event) => {
    if (closed) {
      throw new Error('Event publisher is closed');
    }

    const envelope = normalizeEventEnvelope(event);
    const headers: Record<string, string> = { ...(options.proxy?.headers ?? {}) };

    if (!headerHasName(headers, 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }

    if (!headerHasName(headers, 'authorization') && !headerHasName(headers, 'x-apphub-event-token')) {
      const envToken = process.env.APPHUB_EVENT_PROXY_TOKEN;
      const tokenValue = await resolveProxyToken(options.proxy?.token, envToken);
      if (tokenValue) {
        headers.Authorization = `Bearer ${tokenValue}`;
      }
    }

    const response = await fetchImpl(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope)
    });

    let rawBody: string | null = null;
    try {
      rawBody = await response.text();
    } catch {
      rawBody = null;
    }

    let responseBody: unknown = null;
    if (rawBody && rawBody.length > 0) {
      try {
        responseBody = JSON.parse(rawBody);
      } catch {
        responseBody = rawBody;
      }
    }

    if (!response.ok) {
      if (responseBody && typeof responseBody === 'object' && responseBody !== null) {
        const errorValue = (responseBody as Record<string, unknown>).error;
        if (typeof errorValue === 'string' && errorValue.trim().length > 0) {
          throw new Error(errorValue);
        }
      }
      throw new Error(`Event proxy responded with status ${response.status}`);
    }

    if (responseBody && typeof responseBody === 'object' && responseBody !== null) {
      const container = responseBody as Record<string, unknown>;
      const data = container.data;
      const maybeEvent =
        (data && typeof data === 'object'
          ? (data as Record<string, unknown>).event
          : undefined) ?? container.event;
      if (maybeEvent) {
        try {
          return validateEventEnvelope(maybeEvent);
        } catch {
          // Ignore and fall through to return the locally normalized envelope.
        }
      }
    }

    return envelope;
  };

  const close = async () => {
    closed = true;
  };

  return {
    publish,
    close,
    queue: null
  } satisfies EventPublisherHandleBase<null, TOptions>;
}
