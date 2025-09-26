import { SpanStatusCode, context, trace, type Span, type Tracer } from '@opentelemetry/api';

export interface TracingOptions {
  enabled: boolean;
  serviceName: string;
}

let tracingEnabled = false;
let tracerInstance: Tracer | null = null;

export function setupTracing(options: TracingOptions): void {
  tracingEnabled = options.enabled;
  tracerInstance = tracingEnabled ? trace.getTracer(options.serviceName, '1.0.0') : null;
}

export function startSpan(
  name: string,
  attributes?: Record<string, unknown>
): Span | null {
  if (!tracingEnabled || !tracerInstance) {
    return null;
  }
  const span = tracerInstance.startSpan(name, undefined, context.active());
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      span.setAttribute(key, normalizeAttribute(value));
    }
  }
  return span;
}

export function endSpan(span: Span | null, error?: unknown): void {
  if (!span) {
    return;
  }
  if (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

export function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, unknown>
): Promise<T> {
  const span = startSpan(name, attributes);
  return fn()
    .then((result) => {
      endSpan(span);
      return result;
    })
    .catch((error) => {
      endSpan(span, error);
      throw error;
    });
}

function normalizeAttribute(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '[unserializable]';
    }
  }
  if (value === undefined || value === null) {
    return 'null';
  }
  return String(value);
}

export function isTracingEnabled(): boolean {
  return tracingEnabled;
}
