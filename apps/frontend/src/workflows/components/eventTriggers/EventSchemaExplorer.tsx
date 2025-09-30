import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../../../components/Spinner';
import { useToasts } from '../../../components/toast';
import type {
  WorkflowEventSchema,
  WorkflowEventSchemaField,
  WorkflowEventSchemaValueType
} from '../../types';

const HEADER_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const HEADER_META_CLASSES = 'text-scale-xs text-secondary';

const LOADING_STATE_CLASSES =
  'flex h-24 items-center justify-center rounded-2xl border border-subtle bg-surface-glass text-scale-xs text-secondary shadow-elevation-sm';

const EMPTY_STATE_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-xs text-secondary shadow-elevation-sm';

const TREE_CONTAINER_CLASSES =
  'max-h-64 min-w-[220px] flex-1 overflow-y-auto rounded-2xl border border-subtle bg-surface-glass shadow-elevation-sm';

const DETAIL_CONTAINER_CLASSES =
  'flex-1 rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-sm';

const TREE_ITEM_BASE =
  'flex items-center justify-between gap-2 rounded-xl px-2 py-1 text-scale-xs transition-colors';

const TREE_ITEM_ACTIVE = 'bg-accent-soft text-accent';

const TREE_ITEM_INACTIVE = 'text-secondary hover:bg-surface-glass-soft';

const TREE_TOGGLE_BUTTON_CLASSES =
  'rounded-md border border-transparent p-1 text-[10px] text-muted transition-colors hover:text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CODE_BADGE_CLASSES = 'rounded-lg bg-surface-glass px-2 py-1 text-scale-xs text-secondary';

const ACTION_CHIP_PRIMARY =
  'rounded-full border border-accent bg-accent px-3 py-1 text-[11px] font-weight-semibold text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const ACTION_CHIP_SECONDARY =
  'rounded-full border border-accent bg-accent-soft px-3 py-1 text-[11px] font-weight-semibold text-accent transition-colors hover:bg-accent-soft/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const ACTION_CHIP_GHOST =
  'rounded-full border border-subtle bg-surface-glass px-3 py-1 text-[11px] font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const EXAMPLE_BUTTON_ACTIVE = 'border-accent bg-accent-soft text-accent';

const EXAMPLE_BUTTON_INACTIVE =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:text-accent-strong';

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
                className={`${TREE_ITEM_BASE} ${isSelected ? TREE_ITEM_ACTIVE : TREE_ITEM_INACTIVE}`}
                style={{ paddingLeft: `${depth * 12 + 8}px` }}
              >
                <div className="flex items-center gap-2">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => handleToggle(node.key)}
                      className={TREE_TOGGLE_BUTTON_CLASSES}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="w-4" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleSelect(node.key)}
                    className="text-left text-scale-xs font-weight-semibold"
                  >
                    {node.label}
                  </button>
                </div>
                {displayTypes && <span className="text-[10px] uppercase text-muted">{displayTypes}</span>}
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
          <h4 className={HEADER_TITLE_CLASSES}>Event schema explorer</h4>
          {schema && schema.totalSamples > 0 ? (
            <p className={HEADER_META_CLASSES}>
              Based on {schema.totalSamples} sample{schema.totalSamples === 1 ? '' : 's'}
            </p>
          ) : (
            <p className={HEADER_META_CLASSES}>Load recent events to inspect available fields.</p>
          )}
        </div>
        {loading && <Spinner size="xs" />}
      </div>

      {loading && (!schema || schema.fields.length === 0) ? (
        <div className={LOADING_STATE_CLASSES}>Loading event schema…</div>
      ) : !schema || schema.fields.length === 0 ? (
        <div className={EMPTY_STATE_CLASSES}>
          No schema information available yet. Load matching events to explore fields.
        </div>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className={TREE_CONTAINER_CLASSES}>{renderTree(root.children)}</div>
          <div className={DETAIL_CONTAINER_CLASSES}>
            {!selectedField ? (
              <p className={HEADER_META_CLASSES}>Select a field to view details.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[11px] font-weight-semibold uppercase tracking-[0.25em] text-muted">Field</p>
                  <p className="text-scale-sm font-weight-semibold text-primary">
                    {formatPath(selectedField.path)}
                  </p>
                  <p className={HEADER_META_CLASSES}>
                    Appears in {selectedField.occurrences} of {schema.totalSamples} sample
                    {schema.totalSamples === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-weight-semibold uppercase tracking-[0.25em] text-muted">JSONPath</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className={CODE_BADGE_CLASSES}>{selectedField.jsonPath}</code>
                    <button
                      type="button"
                      className={ACTION_CHIP_GHOST}
                      onClick={() => handleCopy(selectedField.jsonPath, 'JSONPath')}
                    >
                      Copy
                    </button>
                    {onAddPredicate && (
                      <>
                        <button
                          type="button"
                          className={ACTION_CHIP_PRIMARY}
                          onClick={() => handleAddPredicate('exists')}
                          disabled={disabled}
                        >
                          Add exists predicate
                        </button>
                        <button
                          type="button"
                          className={ACTION_CHIP_SECONDARY}
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
                  <p className="text-[11px] font-weight-semibold uppercase tracking-[0.25em] text-muted">
                    Liquid snippet
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className={CODE_BADGE_CLASSES}>{`{{ ${selectedField.liquidPath} }}`}</code>
                    <button
                      type="button"
                      className={ACTION_CHIP_GHOST}
                      onClick={() => handleCopy(`{{ ${selectedField.liquidPath} }}`, 'Liquid snippet')}
                    >
                      Copy
                    </button>
                    {onInsertLiquid && (
                      <button
                        type="button"
                        className={ACTION_CHIP_PRIMARY}
                        onClick={handleInsertLiquid}
                        disabled={disabled}
                      >
                        Insert into template
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[11px] font-weight-semibold uppercase tracking-[0.25em] text-muted">
                    Example values
                  </p>
                  {examples.length === 0 ? (
                    <p className={HEADER_META_CLASSES}>No example values captured yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {examples.map((example, index) => {
                        const label = stringifyExample(example);
                        const isActive = index === effectiveExampleIndex;
                        return (
                          <button
                            type="button"
                            key={`${selectedField.jsonPath}-example-${index}`}
                            className={`rounded-xl border px-3 py-2 text-left text-scale-xs transition-colors ${
                              isActive ? EXAMPLE_BUTTON_ACTIVE : EXAMPLE_BUTTON_INACTIVE
                            }`}
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
