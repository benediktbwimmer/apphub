import { Counter, Histogram } from 'prom-client';
import { register } from './queueTelemetry';

const publishCounter = new Counter({
  name: 'apphub_stream_mirror_publish_total',
  help: 'Total number of streaming mirror publish attempts by result.',
  labelNames: ['topic', 'result'],
  registers: [register]
});

const publishDuration = new Histogram({
  name: 'apphub_stream_mirror_publish_duration_ms',
  help: 'Streaming mirror publish latency in milliseconds.',
  labelNames: ['topic', 'result'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
  registers: [register]
});

export type PublishResult = 'success' | 'failure';

export function recordMirrorPublish(topic: string, result: PublishResult, durationMs: number): void {
  publishCounter.inc({ topic, result });
  publishDuration.observe({ topic, result }, durationMs);
}
