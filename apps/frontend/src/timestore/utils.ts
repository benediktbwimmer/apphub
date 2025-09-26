export function formatInstant(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export type PromMetric = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

export function parsePrometheusMetrics(text: string): PromMetric[] {
  const metrics: PromMetric[] = [];
  const lineRegex = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?|[+-]?(?:Inf|NaN))$/;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = lineRegex.exec(line);
    if (!match) {
      continue;
    }
    const [, name, , labelBlock = '', valueLiteral] = match;
    const labels = parseLabelBlock(labelBlock);
    const value = Number(valueLiteral);
    metrics.push({ name, labels, value });
  }

  return metrics;
}

export function findMetricValue(
  metrics: PromMetric[],
  name: string,
  labels: Record<string, string> = {}
): number | null {
  for (const metric of metrics) {
    if (metric.name !== name) {
      continue;
    }
    if (matchesLabels(metric.labels, labels)) {
      return metric.value;
    }
  }
  return null;
}

export function sumMetricValues(
  metrics: PromMetric[],
  name: string,
  labels: Record<string, string> = {}
): number {
  return metrics
    .filter((metric) => metric.name === name && matchesLabels(metric.labels, labels))
    .reduce((acc, metric) => acc + metric.value, 0);
}

function matchesLabels(
  metricLabels: Record<string, string>,
  expected: Record<string, string>
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (metricLabels[key] !== value) {
      return false;
    }
  }
  return true;
}

function parseLabelBlock(block: string): Record<string, string> {
  const trimmed = block.replace(/^\{/, '').replace(/\}$/, '');
  if (!trimmed) {
    return {};
  }
  const result: Record<string, string> = {};
  const parts = trimmed.match(/([^=,]+="(?:\\"|[^"])*"|[^=,]+=[^,]+)/g) ?? [];
  for (const part of parts) {
    const [key, rawValue] = part.split('=', 2);
    if (!key || rawValue === undefined) {
      continue;
    }
    result[key.trim()] = decodePrometheusLabelValue(rawValue.trim());
  }
  return result;
}

function decodePrometheusLabelValue(value: string): string {
  if (!value.startsWith('"')) {
    return value;
  }
  try {
    return JSON.parse(value.replace(/\\"/g, '"')) as string;
  } catch {
    return value.slice(1, -1);
  }
}
