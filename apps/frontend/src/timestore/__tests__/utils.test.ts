import { describe, expect, it } from 'vitest';
import { parsePrometheusMetrics, findMetricValue, sumMetricValues } from '../utils';

describe('timestore utils', () => {
  it('parses Prometheus metrics with labels', () => {
    const text = `# HELP timestore_ingest_requests_total total ingress\n` +
      `timestore_ingest_requests_total{dataset="a",mode="inline",result="success"} 5\n` +
      `timestore_ingest_requests_total{dataset="a",mode="inline",result="failure"} 2\n` +
      `timestore_query_duration_seconds_sum 10.5\n` +
      `timestore_query_duration_seconds_count 3`;

    const metrics = parsePrometheusMetrics(text);
    expect(metrics).toHaveLength(4);
    expect(findMetricValue(metrics, 'timestore_ingest_requests_total', { result: 'success', dataset: 'a' })).toBe(5);
    expect(findMetricValue(metrics, 'timestore_ingest_requests_total', { result: 'failure', dataset: 'a' })).toBe(2);
    expect(sumMetricValues(metrics, 'timestore_query_duration_seconds_sum')).toBeCloseTo(10.5);
    expect(sumMetricValues(metrics, 'timestore_query_duration_seconds_count')).toBe(3);
  });
});
