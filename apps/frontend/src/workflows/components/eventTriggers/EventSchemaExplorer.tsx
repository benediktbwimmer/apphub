import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../../components/Spinner';
import { useToasts } from '../../../components/toast';
import type {
  WorkflowEventSchema,
  WorkflowEventSchemaField,
  WorkflowEventSchemaValueType
} from '../../types';

type SchemaTreeNode = {
  key: string;
  segment: string;
  label: string;
  path: string[];
  field: WorkflowEventSchemaField | null;
  children: SchemaTreeNode[];
};

type SchemaTree = {
  root: SchemaTreeNode;
  nodeMap: Map<string, SchemaTreeNode>;
  firstKey: string | null;
};

type PredicateInsertRequest = {
  path: string;
  operator: 'exists' | 'equals';
  value?: unknown;
};

type EventSchemaExplorerProps = {
  schema: WorkflowEventSchema | null;
  loading?: boolean;
  disabled?: boolean;
  onAddPredicate?: (request: PredicateInsertRequest) => void;
  onInsertLiquid?: (snippet: string) => void;
};

const TYPE_LABELS: Record<WorkflowEventSchemaValueType, string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
  object: 'object',
  array: 'array',
  unknown: 'unknown'
};

function buildSchemaTree(schema: WorkflowEventSchema | null): SchemaTree {
  const root: SchemaTreeNode = {
    key: '',
    segment: '$',
    label: 'event',
    path: [],
    field: null,
    children: []
  } satisfies SchemaTreeNode;

  const nodeMap = new Map<string, SchemaTreeNode>();
  nodeMap.set('', root);

  if (!schema || schema.fields.length === 0) {
    return { root, nodeMap, firstKey: null } satisfies SchemaTree;
  }

  const fieldMap = new Map<string, WorkflowEventSchemaField>();
  for (const field of schema.fields) {
    const key = field.path.join('.');
    fieldMap.set(key, field);
  }

  const ensureNode = (segments: string[]): SchemaTreeNode => {
    const key = segments.join('.');
    const existing = nodeMap.get(key);
    if (existing) {
      return existing;
    }
    const parentSegments = segments.slice(0, -1);
    const parent = ensureNode(parentSegments);
    const segment = segments[segments.length - 1] ?? '';
    const node: SchemaTreeNode = {
      key,
      segment,
      label: formatSegment(segment),
      path: [...segments],
      field: fieldMap.get(key) ?? null,
      children: []
    } satisfies SchemaTreeNode;
    nodeMap.set(key, node);
    parent.children.push(node);
    parent.children.sort((a, b) => a.label.localeCompare(b.label));
    return node;
  };

  const sortedKeys = Array.from(fieldMap.keys()).sort((left, right) => {
    const leftParts = left === '' ? [] : left.split('.');
    const rightParts = right === '' ? [] : right.split('.');
    if (leftParts.length !== rightParts.length) {
      return leftParts.length - rightParts.length;
    }
    return left.localeCompare(right);
  });

  for (const key of sortedKeys) {
    const segments = key === '' ? [] : key.split('.');
    const node = ensureNode(segments);
    node.field = fieldMap.get(key) ?? node.field;
  }

  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.label.localeCompare(b.label));
  }

  const firstKey = sortedKeys.length > 0 ? sortedKeys[0] : null;
  return { root, nodeMap, firstKey } satisfies SchemaTree;
}

function formatSegment(segment: string): string {
  if (segment === '*') {
    return '[item]';
  }
  return segment || 'root';
}

function formatPath(path: string[]): string {
  if (path.length === 0) {
    return 'event';
  }
  return path.map((segment) => (segment === '*' ? '[item]' : segment)).join('.');
}

function formatTypes(field: WorkflowEventSchemaField | null): string {
  if (!field) {
    return '';
  }
  return field.types.map((type) => TYPE_LABELS[type]).join(' · ');
}

function stringifyExample(example: unknown): string {
  if (example === null || example === undefined) {
    return 'null';
  }
  if (typeof example === 'string') {
    return example;
  }
  if (typeof example === 'number' || typeof example === 'boolean') {
    return String(example);
  }
  try {
    return JSON.stringify(example, null, 2);
  } catch {
    return String(example);
  }
}

export default function EventSchemaExplorer({
  schema,
  loading = false,
  disabled = false,
  onAddPredicate,
  onInsertLiquid
}: EventSchemaExplorerProps) {
  const { root, nodeMap, firstKey } = useMemo(() => buildSchemaTree(schema), [schema]);
  const [selectedKey, setSelectedKey] = useState<string | null>(firstKey);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(['']));
  const [selectedExampleIndex, setSelectedExampleIndex] = useState(0);
  const { pushToast } = useToasts();

  useEffect(() => {
    setSelectedKey(firstKey);
    setSelectedExampleIndex(0);
    const initial = new Set<string>(['']);
    if (firstKey) {
      const segments = firstKey.split('.');
      const buffer: string[] = [];
      for (const segment of segments) {
        buffer.push(segment);
        initial.add(buffer.join('.'));
      }
    }
    setExpandedKeys(initial);
  }, [firstKey]);

  const selectedNode = selectedKey ? nodeMap.get(selectedKey) ?? null : null;
  const selectedField = selectedNode?.field ?? null;
  const examples = selectedField?.examples ?? [];
  const effectiveExampleIndex = Math.min(selectedExampleIndex, Math.max(examples.length - 1, 0));
  const selectedExample = examples[effectiveExampleIndex];

  const handleToggle = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelect = (key: string) => {
    setSelectedKey(key);
    setSelectedExampleIndex(0);
  };

  const handleCopy = async (value: string, label: string) => {
    if (!value) {
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        pushToast({
          tone: 'success',
          title: `${label} copied`,
          description: value
        });
      }
    } catch {
      pushToast({
        tone: 'error',
        title: `Unable to copy ${label.toLowerCase()}`
      });
    }
  };

  const handleAddPredicate = (operator: PredicateInsertRequest['operator']) => {
    if (!selectedField || !onAddPredicate || disabled) {
      return;
    }
    if (operator === 'equals' && selectedExample === undefined) {
      pushToast({
        tone: 'error',
        title: 'No example value available for equals predicate'
      });
      return;
    }
    const payload: PredicateInsertRequest = {
      path: selectedField.jsonPath,
      operator
    } satisfies PredicateInsertRequest;
    if (operator === 'equals') {
      payload.value = selectedExample;
    }
    onAddPredicate(payload);
    pushToast({
      tone: 'success',
      title: operator === 'exists' ? 'Exists predicate added' : 'Equals predicate added',
      description: selectedField.jsonPath
    });
  };

  const handleInsertLiquid = () => {
    if (!selectedField || !onInsertLiquid || disabled) {
      return;
    }
    const snippet = `"{{ ${selectedField.liquidPath} }}"`;
    onInsertLiquid(snippet);
    pushToast({
      tone: 'success',
      title: 'Liquid snippet inserted',
      description: snippet
    });
  };

  const renderTree = (nodes: SchemaTreeNode[], depth = 0) => {
    return (
      <ul>
        {nodes.map((node) => {
          const hasChildren = node.children.length > 0;
          const isExpanded = expandedKeys.has(node.key);
          const isSelected = node.key === selectedKey;
          const displayTypes = formatTypes(node.field);
          return (
            <li key={node.key || 'root'}>
              <div
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs transition ${isSelected ? 'bg-indigo-50 text-indigo-700 dark:bg-slate-800/70 dark:text-indigo-200' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                <div className="flex items-center gap-2">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => handleToggle(node.key)}
                      className="rounded-md border border-transparent p-1 text-[10px] text-slate-400 transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="w-4" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelect(node.key)}
                    className="text-left text-xs font-semibold"
                  >
                    {node.label}
                  </button>
                </div>
                {displayTypes && <span className="text-[10px] uppercase text-slate-400 dark:text-slate-500">{displayTypes}</span>}
              </div>
              {hasChildren && isExpanded && renderTree(node.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Event schema explorer</h4>
          {schema && schema.totalSamples > 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Based on {schema.totalSamples} sample{schema.totalSamples === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Load recent events to inspect available fields.
            </p>
          )}
        </div>
        {loading && <Spinner size="xs" />}
      </div>

      {loading && (!schema || schema.fields.length === 0) ? (
        <div className="flex h-24 items-center justify-center rounded-xl border border-slate-200/70 bg-slate-50/70 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
          Loading event schema…
        </div>
      ) : !schema || schema.fields.length === 0 ? (
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400">
          No schema information available yet. Load matching events to explore fields.
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="max-h-64 min-w-[220px] flex-1 overflow-y-auto rounded-xl border border-slate-200/70 bg-white dark:border-slate-700/60 dark:bg-slate-900">
            {renderTree(root.children)}
          </div>
          <div className="flex-1 rounded-xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/60 dark:bg-slate-900">
            {!selectedField ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Select a field to view details.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Field
                  </p>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {formatPath(selectedField.path)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Appears in {selectedField.occurrences} of {schema.totalSamples} sample
                    {schema.totalSamples === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    JSONPath
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {selectedField.jsonPath}
                    </code>
                    <button
                      type="button"
                      className="rounded-full border border-slate-200/70 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => handleCopy(selectedField.jsonPath, 'JSONPath')}
                    >
                      Copy
                    </button>
                    {onAddPredicate && (
                      <>
                        <button
                          type="button"
                          className="rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleAddPredicate('exists')}
                          disabled={disabled}
                        >
                          Add exists predicate
                        </button>
                        <button
                          type="button"
                          className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
                          onClick={() => handleAddPredicate('equals')}
                          disabled={disabled || selectedExample === undefined}
                        >
                          Add equals predicate
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Liquid snippet
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">{`{{ ${selectedField.liquidPath} }}`}</code>
                    <button
                      type="button"
                      className="rounded-full border border-slate-200/70 px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => handleCopy(`{{ ${selectedField.liquidPath} }}`, 'Liquid snippet')}
                    >
                      Copy
                    </button>
                    {onInsertLiquid && (
                      <button
                        type="button"
                        className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={handleInsertLiquid}
                        disabled={disabled}
                      >
                        Insert into template
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Example values
                  </p>
                  {examples.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No example values captured yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {examples.map((example, index) => {
                        const label = stringifyExample(example);
                        const isActive = index === effectiveExampleIndex;
                        return (
                          <button
                            type="button"
                            key={`${selectedField.jsonPath}-example-${index}`}
                            className={`rounded-xl border px-3 py-2 text-left text-xs transition ${isActive ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/60 dark:bg-indigo-900/30 dark:text-indigo-200' : 'border-slate-200/70 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:text-indigo-200'}`}
                            onClick={() => setSelectedExampleIndex(index)}
                          >
                            {label.length > 120 ? `${label.slice(0, 117)}…` : label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
