import type { WorkflowEventRecord } from './db/types';

export type WorkflowEventSchemaValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';

export type WorkflowEventSchemaFieldKind = 'value' | 'object' | 'array';

export type WorkflowEventSchemaField = {
  path: string[];
  jsonPath: string;
  liquidPath: string;
  occurrences: number;
  types: WorkflowEventSchemaValueType[];
  kind: WorkflowEventSchemaFieldKind;
  examples: unknown[];
};

export type WorkflowEventSchema = {
  totalSamples: number;
  fields: WorkflowEventSchemaField[];
};

type SchemaNode = {
  segments: string[];
  occurrences: number;
  types: Set<WorkflowEventSchemaValueType>;
  examples: unknown[];
  exampleKeys: Set<string>;
};

type SchemaAccumulator = Map<string, SchemaNode>;

type TraverseState = {
  accumulator: SchemaAccumulator;
  visited: Set<string>;
};

export function buildWorkflowEventSchema(events: WorkflowEventRecord[]): WorkflowEventSchema {
  const accumulator: SchemaAccumulator = new Map();
  for (const event of events) {
    const envelope = buildEventEnvelope(event);
    const visited = new Set<string>();
    traverseValue(envelope, [], { accumulator, visited });
  }

  const fields = Array.from(accumulator.values())
    .filter((node) => node.segments.length > 0)
    .map((node) => toSchemaField(node, events.length))
    .sort((a, b) => a.jsonPath.localeCompare(b.jsonPath));

  return {
    totalSamples: events.length,
    fields
  };
}

function buildEventEnvelope(event: WorkflowEventRecord): Record<string, unknown> {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    payload: event.payload ?? null,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    correlationId: event.correlationId ?? null,
    ttlMs: event.ttlMs ?? null,
    metadata: event.metadata ?? null
  } satisfies Record<string, unknown>;
}

function traverseValue(value: unknown, segments: string[], state: TraverseState): void {
  if (value === undefined) {
    return;
  }

  const node = ensureSchemaNode(state.accumulator, segments);
  const key = serializePath(segments);

  if (!state.visited.has(key)) {
    node.occurrences += 1;
    state.visited.add(key);
  }

  const valueType = detectValueType(value);
  node.types.add(valueType);

  if (valueType !== 'object' && valueType !== 'array') {
    addExample(node, value);
  }

  if (valueType === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [childKey, childValue] of entries) {
      traverseValue(childValue, [...segments, childKey], state);
    }
    return;
  }

  if (valueType === 'array') {
    const arrayValue = value as unknown[];
    for (const element of arrayValue) {
      traverseValue(element, [...segments, '*'], state);
    }
  }
}

function ensureSchemaNode(accumulator: SchemaAccumulator, segments: string[]): SchemaNode {
  const key = serializePath(segments);
  let node = accumulator.get(key);
  if (!node) {
    node = {
      segments: [...segments],
      occurrences: 0,
      types: new Set<WorkflowEventSchemaValueType>(),
      examples: [],
      exampleKeys: new Set<string>()
    } satisfies SchemaNode;
    accumulator.set(key, node);
  }
  return node;
}

function serializePath(segments: string[]): string {
  return segments.join('\u0000');
}

function detectValueType(value: unknown): WorkflowEventSchemaValueType {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return type;
  }
  if (type === 'object') {
    return 'object';
  }
  return 'unknown';
}

function addExample(node: SchemaNode, value: unknown): void {
  if (node.examples.length >= 5) {
    return;
  }
  const example = summarizeExample(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(example);
  } catch {
    serialized = String(example);
  }
  if (node.exampleKeys.has(serialized)) {
    return;
  }
  node.examples.push(example);
  node.exampleKeys.add(serialized);
}

function summarizeExample(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    if (value.length <= 80) {
      return value;
    }
    return `${value.slice(0, 77)}…`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= 1) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 3).map((entry) => summarizeExample(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (depth >= 1) {
      return `{object:${keys.slice(0, 5).join(', ')}}`;
    }
    const result: Record<string, unknown> = {};
    for (const key of keys.slice(0, 5)) {
      result[key] = summarizeExample(record[key], depth + 1);
    }
    return result;
  }
  return String(value);
}

function toSchemaField(node: SchemaNode, totalSamples: number): WorkflowEventSchemaField {
  const types = Array.from(node.types).sort();
  const kind = inferFieldKind(types);
  const jsonPath = buildJsonPath(node.segments);
  const liquidPath = buildLiquidPath(node.segments, kind);
  const examples = node.examples.slice(0, 5);

  return {
    path: [...node.segments],
    jsonPath,
    liquidPath,
    occurrences: Math.min(node.occurrences, totalSamples),
    types,
    kind,
    examples
  } satisfies WorkflowEventSchemaField;
}

function inferFieldKind(types: WorkflowEventSchemaValueType[]): WorkflowEventSchemaFieldKind {
  const typeSet = new Set(types);
  if (typeSet.has('array')) {
    if (typeSet.size === 1 || (typeSet.size === 2 && typeSet.has('null'))) {
      return 'array';
    }
  }
  if (typeSet.has('object')) {
    if (typeSet.size === 1 || (typeSet.size === 2 && typeSet.has('null'))) {
      return 'object';
    }
  }
  return 'value';
}

function buildJsonPath(segments: string[]): string {
  if (segments.length === 0) {
    return '$';
  }
  let path = '$';
  for (const segment of segments) {
    if (segment === '*') {
      path += '[*]';
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      path += `.${segment}`;
      continue;
    }
    const escaped = segment.replace(/'/g, "\\'");
    path += `['${escaped}']`;
  }
  return path;
}

function buildLiquidPath(segments: string[], kind: WorkflowEventSchemaFieldKind): string {
  if (segments.length === 0) {
    return 'event';
  }
  let path = 'event';
  for (const segment of segments) {
    if (segment === '*') {
      path += '[0]';
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      path += `.${segment}`;
      continue;
    }
    const escaped = segment.replace(/"/g, '\\"');
    path += `["${escaped}"]`;
  }
  if (kind === 'array') {
    return path;
  }
  return path;
}
