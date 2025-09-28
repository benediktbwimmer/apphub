import classNames from 'classnames';
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import ReactFlow, {
  Background,
  MarkerType,
  Panel,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeMouseHandler,
  type ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useIsDarkMode } from '../../hooks/useIsDarkMode';
import {
  buildWorkflowGraphCanvasModel,
  type WorkflowGraphCanvasSelection,
  type WorkflowGraphCanvasFilters,
  type WorkflowGraphCanvasLayoutConfig,
  type WorkflowGraphCanvasNodeKind,
  type WorkflowGraphCanvasEdgeKind,
  type WorkflowGraphCanvasModel
} from '../graph/canvasModel';
import type { WorkflowGraphLiveOverlay, WorkflowGraphNormalized } from '../graph';

type WorkflowGraphCanvasNodeTheme = {
  background: string;
  border: string;
  borderHighlighted: string;
  text: string;
  mutedText: string;
  badgeBackground: string;
  badgeText: string;
  shadow: string;
};

type WorkflowGraphCanvasTheme = {
  surface: string;
  surfaceMuted: string;
  gridColor: string;
  edgeDefault: string;
  edgeMuted: string;
  edgeHighlight: string;
  edgeDashed: string;
  labelBackground: string;
  labelText: string;
  nodes: Record<WorkflowGraphCanvasNodeKind, WorkflowGraphCanvasNodeTheme>;
};

type WorkflowGraphCanvasThemeOverrides = Partial<Omit<WorkflowGraphCanvasTheme, 'nodes'>> & {
  nodes?: Partial<Record<WorkflowGraphCanvasNodeKind, Partial<WorkflowGraphCanvasNodeTheme>>>;
};

type WorkflowGraphCanvasEdgeData = {
  kind: WorkflowGraphCanvasEdgeKind;
  highlighted: boolean;
};

type WorkflowGraphCanvasNodeData = {
  id: string;
  refId: string;
  label: string;
  subtitle?: string;
  meta: string[];
  badges: string[];
  status?: {
    label: string;
    tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
    tooltip?: string;
  };
  kind: WorkflowGraphCanvasNodeKind;
  highlighted: boolean;
  onSelect?: (data: WorkflowGraphCanvasNodeData) => void;
};

type WorkflowGraphCanvasTooltip = {
  node: WorkflowGraphCanvasNodeData;
  position: { x: number; y: number };
};

const WorkflowGraphCanvasThemeContext = createContext<WorkflowGraphCanvasTheme | null>(null);

const INVISIBLE_HANDLE_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '9999px',
  border: 0,
  background: 'transparent',
  opacity: 0,
  pointerEvents: 'none'
};

function useWorkflowGraphCanvasTheme(): WorkflowGraphCanvasTheme {
  const theme = useContext(WorkflowGraphCanvasThemeContext);
  if (!theme) {
    throw new Error('WorkflowGraphCanvasThemeContext missing provider');
  }
  return theme;
}

const LIGHT_THEME: WorkflowGraphCanvasTheme = {
  surface: 'rgba(255, 255, 255, 0.9)',
  surfaceMuted: 'rgba(248, 250, 252, 0.75)',
  gridColor: '#e2e8f0',
  edgeDefault: '#94a3b8',
  edgeMuted: 'rgba(148, 163, 184, 0.5)',
  edgeHighlight: '#7c3aed',
  edgeDashed: '#64748b',
  labelBackground: '#f8fafc',
  labelText: '#334155',
  nodes: {
    workflow: {
      background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.24), rgba(59, 130, 246, 0.12))',
      border: 'rgba(99, 102, 241, 0.45)',
      borderHighlighted: '#7c3aed',
      text: '#1f2937',
      mutedText: '#4b5563',
      badgeBackground: 'rgba(79, 70, 229, 0.12)',
      badgeText: '#4338ca',
      shadow: '0 26px 48px -32px rgba(79, 70, 229, 0.55)'
    },
    'step-job': {
      background: 'linear-gradient(135deg, rgba(94, 234, 212, 0.18), rgba(14, 165, 233, 0.12))',
      border: 'rgba(20, 184, 166, 0.42)',
      borderHighlighted: '#0d9488',
      text: '#0f172a',
      mutedText: '#475569',
      badgeBackground: 'rgba(45, 212, 191, 0.15)',
      badgeText: '#0f766e',
      shadow: '0 16px 40px -28px rgba(13, 148, 136, 0.5)'
    },
    'step-service': {
      background: 'linear-gradient(135deg, rgba(129, 200, 255, 0.18), rgba(14, 116, 144, 0.16))',
      border: 'rgba(56, 189, 248, 0.42)',
      borderHighlighted: '#0284c7',
      text: '#0f172a',
      mutedText: '#475569',
      badgeBackground: 'rgba(125, 211, 252, 0.2)',
      badgeText: '#0369a1',
      shadow: '0 16px 40px -28px rgba(2, 132, 199, 0.45)'
    },
    'step-fanout': {
      background: 'linear-gradient(135deg, rgba(244, 114, 182, 0.16), rgba(251, 191, 36, 0.16))',
      border: 'rgba(249, 115, 22, 0.4)',
      borderHighlighted: '#ea580c',
      text: '#111827',
      mutedText: '#52525b',
      badgeBackground: 'rgba(251, 191, 36, 0.18)',
      badgeText: '#c2410c',
      shadow: '0 18px 46px -30px rgba(249, 115, 22, 0.5)'
    },
    'trigger-event': {
      background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.16), rgba(148, 163, 184, 0.12))',
      border: 'rgba(99, 102, 241, 0.28)',
      borderHighlighted: '#6366f1',
      text: '#1e293b',
      mutedText: '#475569',
      badgeBackground: 'rgba(129, 140, 248, 0.2)',
      badgeText: '#4c1d95',
      shadow: '0 16px 40px -32px rgba(99, 102, 241, 0.45)'
    },
    'trigger-definition': {
      background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.12), rgba(37, 99, 235, 0.08))',
      border: 'rgba(59, 130, 246, 0.32)',
      borderHighlighted: '#2563eb',
      text: '#1e293b',
      mutedText: '#475569',
      badgeBackground: 'rgba(191, 219, 254, 0.3)',
      badgeText: '#1d4ed8',
      shadow: '0 16px 40px -32px rgba(37, 99, 235, 0.5)'
    },
    schedule: {
      background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.95), rgba(226, 232, 240, 0.6))',
      border: 'rgba(148, 163, 184, 0.45)',
      borderHighlighted: '#64748b',
      text: '#1e293b',
      mutedText: '#475569',
      badgeBackground: 'rgba(125, 211, 252, 0.25)',
      badgeText: '#1d4ed8',
      shadow: '0 14px 32px -26px rgba(148, 163, 184, 0.4)'
    },
    asset: {
      background: 'linear-gradient(135deg, rgba(252, 165, 165, 0.16), rgba(254, 215, 170, 0.12))',
      border: 'rgba(248, 113, 113, 0.44)',
      borderHighlighted: '#f97316',
      text: '#111827',
      mutedText: '#52525b',
      badgeBackground: 'rgba(248, 113, 113, 0.2)',
      badgeText: '#b91c1c',
      shadow: '0 18px 46px -30px rgba(248, 113, 113, 0.48)'
    },
    'event-source': {
      background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.18), rgba(134, 239, 172, 0.18))',
      border: 'rgba(34, 197, 94, 0.4)',
      borderHighlighted: '#22c55e',
      text: '#14532d',
      mutedText: '#15803d',
      badgeBackground: 'rgba(74, 222, 128, 0.25)',
      badgeText: '#166534',
      shadow: '0 16px 36px -28px rgba(34, 197, 94, 0.45)'
    }
  }
};

const DARK_THEME: WorkflowGraphCanvasTheme = {
  surface: 'rgba(15, 23, 42, 0.82)',
  surfaceMuted: 'rgba(15, 23, 42, 0.68)',
  gridColor: 'rgba(71, 85, 105, 0.2)',
  edgeDefault: '#a855f7',
  edgeMuted: 'rgba(168, 85, 247, 0.5)',
  edgeHighlight: '#f472b6',
  edgeDashed: '#38bdf8',
  labelBackground: 'rgba(15, 23, 42, 0.94)',
  labelText: '#f8fafc',
  nodes: {
    workflow: {
      background: 'linear-gradient(135deg, rgba(76, 29, 149, 0.48), rgba(37, 99, 235, 0.32))',
      border: 'rgba(129, 140, 248, 0.55)',
      borderHighlighted: '#c4b5fd',
      text: '#f8fafc',
      mutedText: 'rgba(226, 232, 240, 0.7)',
      badgeBackground: 'rgba(99, 102, 241, 0.32)',
      badgeText: '#c7d2fe',
      shadow: '0 26px 48px -32px rgba(129, 140, 248, 0.55)'
    },
    'step-job': {
      background: 'linear-gradient(135deg, rgba(13, 148, 136, 0.4), rgba(3, 105, 161, 0.36))',
      border: 'rgba(45, 212, 191, 0.5)',
      borderHighlighted: '#5eead4',
      text: '#f8fafc',
      mutedText: 'rgba(203, 213, 225, 0.72)',
      badgeBackground: 'rgba(20, 184, 166, 0.28)',
      badgeText: '#ccfbf1',
      shadow: '0 16px 40px -26px rgba(20, 184, 166, 0.55)'
    },
    'step-service': {
      background: 'linear-gradient(135deg, rgba(13, 148, 210, 0.35), rgba(8, 145, 178, 0.32))',
      border: 'rgba(56, 189, 248, 0.5)',
      borderHighlighted: '#38bdf8',
      text: '#f8fafc',
      mutedText: 'rgba(203, 213, 225, 0.72)',
      badgeBackground: 'rgba(59, 130, 246, 0.28)',
      badgeText: '#bfdbfe',
      shadow: '0 16px 40px -26px rgba(56, 189, 248, 0.55)'
    },
    'step-fanout': {
      background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.35), rgba(147, 51, 234, 0.28))',
      border: 'rgba(249, 115, 22, 0.45)',
      borderHighlighted: '#fb923c',
      text: '#f8fafc',
      mutedText: 'rgba(248, 250, 252, 0.7)',
      badgeBackground: 'rgba(249, 115, 22, 0.28)',
      badgeText: '#fed7aa',
      shadow: '0 18px 46px -28px rgba(249, 115, 22, 0.55)'
    },
    'trigger-event': {
      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.38), rgba(59, 130, 246, 0.28))',
      border: 'rgba(129, 140, 248, 0.5)',
      borderHighlighted: '#8b5cf6',
      text: '#f8fafc',
      mutedText: 'rgba(203, 213, 225, 0.72)',
      badgeBackground: 'rgba(99, 102, 241, 0.32)',
      badgeText: '#d8b4fe',
      shadow: '0 16px 40px -28px rgba(99, 102, 241, 0.55)'
    },
    'trigger-definition': {
      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.32), rgba(37, 99, 235, 0.28))',
      border: 'rgba(96, 165, 250, 0.5)',
      borderHighlighted: '#60a5fa',
      text: '#f8fafc',
      mutedText: 'rgba(203, 213, 225, 0.72)',
      badgeBackground: 'rgba(37, 99, 235, 0.32)',
      badgeText: '#bfdbfe',
      shadow: '0 16px 40px -28px rgba(37, 99, 235, 0.5)'
    },
    schedule: {
      background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.82), rgba(15, 23, 42, 0.65))',
      border: 'rgba(148, 163, 184, 0.54)',
      borderHighlighted: '#94a3b8',
      text: '#f1f5f9',
      mutedText: 'rgba(203, 213, 225, 0.7)',
      badgeBackground: 'rgba(148, 163, 184, 0.28)',
      badgeText: '#e2e8f0',
      shadow: '0 14px 32px -24px rgba(148, 163, 184, 0.45)'
    },
    asset: {
      background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.3), rgba(248, 113, 113, 0.38))',
      border: 'rgba(248, 113, 113, 0.62)',
      borderHighlighted: '#fda4af',
      text: '#f8fafc',
      mutedText: 'rgba(254, 226, 226, 0.7)',
      badgeBackground: 'rgba(248, 113, 113, 0.28)',
      badgeText: '#fecdd3',
      shadow: '0 18px 46px -28px rgba(248, 113, 113, 0.55)'
    },
    'event-source': {
      background: 'linear-gradient(135deg, rgba(22, 163, 74, 0.36), rgba(34, 197, 94, 0.28))',
      border: 'rgba(34, 197, 94, 0.6)',
      borderHighlighted: '#4ade80',
      text: '#f8fafc',
      mutedText: 'rgba(209, 250, 229, 0.78)',
      badgeBackground: 'rgba(34, 197, 94, 0.32)',
      badgeText: '#bbf7d0',
      shadow: '0 16px 36px -26px rgba(34, 197, 94, 0.55)'
    }
  }
};

function mergeTheme(
  base: WorkflowGraphCanvasTheme,
  override?: WorkflowGraphCanvasThemeOverrides
): WorkflowGraphCanvasTheme {
  if (!override) {
    return base;
  }
  const merged: WorkflowGraphCanvasTheme = {
    ...base,
    ...override,
    nodes: { ...base.nodes }
  } as WorkflowGraphCanvasTheme;

  if (override.nodes) {
    for (const key of Object.keys(override.nodes) as WorkflowGraphCanvasNodeKind[]) {
      const existing = base.nodes[key];
      const updates = override.nodes?.[key];
      if (!existing || !updates) {
        continue;
      }
      merged.nodes[key] = {
        ...existing,
        ...updates
      } as WorkflowGraphCanvasNodeTheme;
    }
  }

  return merged;
}

function describeNodeKind(kind: WorkflowGraphCanvasNodeKind): string {
  switch (kind) {
    case 'workflow':
      return 'Workflow';
    case 'step-job':
      return 'Job step';
    case 'step-service':
      return 'Service step';
    case 'step-fanout':
      return 'Fan-out step';
    case 'trigger-event':
      return 'Event trigger';
    case 'trigger-definition':
      return 'Definition trigger';
    case 'schedule':
      return 'Schedule';
    case 'asset':
      return 'Asset';
    case 'event-source':
      return 'Event source';
    default:
      return 'Node';
  }
}

const CONTROL_BUTTON_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white/90 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800/70';

const CONTROL_BUTTON_WIDE_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white/90 px-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800/70';

function WorkflowGraphNode({ data, selected }: NodeProps<WorkflowGraphCanvasNodeData>) {
  const theme = useWorkflowGraphCanvasTheme();
  const variant = theme.nodes[data.kind];
  const isHighlighted = data.highlighted || selected;
  const status = data.status;
  const statusClassName = status ? STATUS_TONE_CLASSES[status.tone] ?? STATUS_TONE_CLASSES.neutral : null;
  const primaryBadge = !status && data.badges.length > 0 ? data.badges[0] : null;
  const secondaryBadges = status ? data.badges : data.badges.slice(primaryBadge ? 1 : 0);
  return (
    <div
      className={classNames(
        'flex h-full w-full flex-col justify-between rounded-2xl border bg-white/90 p-4 text-left transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:bg-slate-950/60',
        isHighlighted ? 'ring-2 ring-violet-300 dark:ring-violet-500/60' : 'ring-0'
      )}
      style={{
        background: variant.background,
        borderColor: isHighlighted ? variant.borderHighlighted : variant.border,
        color: variant.text,
        boxShadow: variant.shadow
      }}
      title={data.subtitle ? `${data.label} • ${data.subtitle}` : data.label}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect?.(data);
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={INVISIBLE_HANDLE_STYLE}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={INVISIBLE_HANDLE_STYLE}
        isConnectable={false}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold leading-5">
            {data.label}
          </p>
          {data.subtitle && (
            <p
              className="text-[11px] uppercase tracking-[0.18em]"
              style={{ color: variant.mutedText }}
            >
              {data.subtitle}
            </p>
          )}
        </div>
        {status ? (
          <span
            className={classNames(
              'inline-flex max-w-[140px] items-center justify-center rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide',
              statusClassName
            )}
            title={status.tooltip ?? status.label}
          >
            {status.label}
          </span>
        ) : primaryBadge ? (
          <span
            className="inline-flex max-w-[120px] items-center justify-center rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: variant.badgeBackground, color: variant.badgeText }}
          >
            {primaryBadge}
          </span>
        ) : null}
      </div>
      {secondaryBadges.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {secondaryBadges.map((badge) => (
            <span
              key={badge}
              className="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: variant.badgeBackground, color: variant.badgeText }}
            >
              {badge}
            </span>
          ))}
        </div>
      )}
      {data.meta.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11px]" style={{ color: variant.mutedText }}>
          {data.meta.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const NODE_TYPES = {
  'workflow-graph-node': WorkflowGraphNode
};

const STATUS_TONE_CLASSES: Record<
  NonNullable<WorkflowGraphCanvasNodeData['status']>['tone'],
  string
> = {
  neutral: 'bg-slate-200 text-slate-700 dark:bg-slate-700/70 dark:text-slate-200',
  info: 'bg-sky-200 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  success: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  warning: 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200',
  danger: 'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-200'
};

type WorkflowGraphCanvasProps = {
  graph: WorkflowGraphNormalized | null;
  loading?: boolean;
  error?: string | null;
  height?: number | string;
  layout?: Partial<WorkflowGraphCanvasLayoutConfig>;
  selection?: WorkflowGraphCanvasSelection;
  filters?: WorkflowGraphCanvasFilters;
  searchTerm?: string | null;
  theme?: WorkflowGraphCanvasThemeOverrides;
  autoFit?: boolean;
  fitViewPadding?: number;
  onNodeSelect?: (nodeId: string, data: WorkflowGraphCanvasNodeData) => void;
  onCanvasClick?: () => void;
  interactionMode?: 'interactive' | 'static';
  overlay?: WorkflowGraphLiveOverlay | null;
};

export function WorkflowGraphCanvas({
  graph,
  loading = false,
  error = null,
  height = 600,
  layout,
  selection,
  filters,
  searchTerm = null,
  theme,
  autoFit = true,
  fitViewPadding = 0.2,
  onNodeSelect,
  onCanvasClick,
  interactionMode = 'interactive',
  overlay = null
}: WorkflowGraphCanvasProps) {
  const isDarkMode = useIsDarkMode();
  const baseTheme = useMemo<WorkflowGraphCanvasTheme>(() => (isDarkMode ? DARK_THEME : LIGHT_THEME), [isDarkMode]);
  const mergedTheme = useMemo(() => mergeTheme(baseTheme, theme), [baseTheme, theme]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<WorkflowGraphCanvasTooltip | null>(null);

  const model = useMemo(() => {
    if (!graph) {
      return null;
    }
    return buildWorkflowGraphCanvasModel(graph, { layout, selection, filters, searchTerm, overlay });
  }, [graph, layout, selection, filters, searchTerm, overlay]);

  const lastNonEmptyModelRef = useRef<WorkflowGraphCanvasModel | null>(null);
  useEffect(() => {
    if (model && model.nodes.length > 0) {
      lastNonEmptyModelRef.current = model;
    }
  }, [model]);

  const resolvedModel = useMemo(() => {
    if (model && (model.nodes.length > 0 || model.filtersApplied || model.searchApplied)) {
      return model;
    }
    return lastNonEmptyModelRef.current;
  }, [model]);

  useEffect(() => {
    setTooltip(null);
  }, [resolvedModel, interactionMode]);

  const handleNodeSelect = useCallback(
    (nodeId: string, payload: WorkflowGraphCanvasNodeData) => {
      setTooltip(null);
      onNodeSelect?.(nodeId, payload);
    },
    [onNodeSelect]
  );

  const reactFlowNodes = useMemo<Node<WorkflowGraphCanvasNodeData>[]>(() => {
    if (!resolvedModel) {
      return [];
    }
    return resolvedModel.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: {
        id: node.id,
        refId: node.refId,
        label: node.label,
        subtitle: node.subtitle,
        meta: node.meta ?? [],
        badges: node.badges ?? [],
        status: node.status,
        kind: node.kind,
        highlighted: node.highlighted,
        onSelect: onNodeSelect
          ? (payload) => handleNodeSelect(node.id, payload)
          : undefined
      },
      type: 'workflow-graph-node',
      draggable: false,
      selectable: true,
      focusable: true,
      style: {
        width: node.width,
        height: node.height
      }
    }));
  }, [resolvedModel, handleNodeSelect, onNodeSelect]);

  const reactFlowEdges = useMemo<Edge<WorkflowGraphCanvasEdgeData>[]>(() => {
    if (!resolvedModel) {
      return [];
    }
    return resolvedModel.edges.map((edge) => {
      const dashed = edge.kind === 'step-consumes' || edge.kind === 'event-source';
      const stroke = edge.highlighted ? mergedTheme.edgeHighlight : dashed ? mergedTheme.edgeDashed : mergedTheme.edgeDefault;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: {
          kind: edge.kind,
          highlighted: edge.highlighted
        },
        label: edge.label,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: mergedTheme.labelBackground, stroke: mergedTheme.edgeMuted },
        labelStyle: { fill: mergedTheme.labelText, fontSize: 11, fontWeight: 600 },
        animated: edge.highlighted,
        type: 'smoothstep',
        style: {
          stroke,
          strokeWidth: edge.highlighted ? 3 : 2.2,
          strokeDasharray: dashed ? '6 4' : undefined,
          opacity: edge.highlighted ? 1 : 0.9
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 18,
          height: 18
        }
      } satisfies Edge<WorkflowGraphCanvasEdgeData>;
    });
  }, [resolvedModel, mergedTheme.edgeDefault, mergedTheme.edgeDashed, mergedTheme.edgeHighlight, mergedTheme.edgeMuted, mergedTheme.labelBackground, mergedTheme.labelText]);

  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const interactive = interactionMode === 'interactive';
  const hasRenderableNodes = Boolean(resolvedModel && resolvedModel.nodes.length > 0);

  const panBy = useCallback(
    (deltaX: number, deltaY: number, duration = 160) => {
      if (!instance) {
        return;
      }
      const viewport = instance.getViewport();
      instance.setViewport(
        {
          x: viewport.x + deltaX,
          y: viewport.y + deltaY,
          zoom: viewport.zoom
        },
        { duration }
      );
    },
    [instance]
  );

  const handleZoomIn = useCallback(() => {
    instance?.zoomIn({ duration: 140 });
  }, [instance]);

  const handleZoomOut = useCallback(() => {
    instance?.zoomOut({ duration: 140 });
  }, [instance]);

  const handleFitView = useCallback(() => {
    if (!instance) {
      return;
    }
    instance.fitView({ padding: fitViewPadding, includeHiddenNodes: false });
  }, [instance, fitViewPadding]);

  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!instance || !interactive || !hasRenderableNodes) {
        return;
      }
      if (event.target !== event.currentTarget) {
        return;
      }
      const baseStep = event.shiftKey ? 240 : 160;
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          panBy(0, baseStep);
          break;
        case 'ArrowDown':
          event.preventDefault();
          panBy(0, -baseStep);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          panBy(baseStep, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          panBy(-baseStep, 0);
          break;
        case '+':
        case '=':
          event.preventDefault();
          instance.zoomIn({ duration: 140 });
          break;
        case '-':
        case '_':
          event.preventDefault();
          instance.zoomOut({ duration: 140 });
          break;
        case '0':
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            instance.fitView({ padding: fitViewPadding, includeHiddenNodes: true });
          }
          break;
        default:
          break;
      }
    },
    [fitViewPadding, hasRenderableNodes, instance, interactive, panBy]
  );

  const handleNodeMouseEnter = useCallback<NodeMouseHandler>((event, node) => {
    if (!containerRef.current) {
      return;
    }
    const nodeData = node.data as WorkflowGraphCanvasNodeData | undefined;
    if (!nodeData) {
      return;
    }
    const bounds = containerRef.current.getBoundingClientRect();
    setTooltip({
      node: nodeData,
      position: {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      }
    });
  }, []);

  const handleNodeMouseMove = useCallback<NodeMouseHandler>((event, node) => {
    if (!containerRef.current) {
      return;
    }
    const nodeData = node.data as WorkflowGraphCanvasNodeData | undefined;
    if (!nodeData) {
      return;
    }
    const bounds = containerRef.current.getBoundingClientRect();
    setTooltip({
      node: nodeData,
      position: {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top
      }
    });
  }, []);

  const handleNodeMouseLeave = useCallback<NodeMouseHandler>(() => {
    setTooltip(null);
  }, []);

  const handleContainerMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  useEffect(() => {
    if (!instance || !resolvedModel || !autoFit || resolvedModel.nodes.length === 0) {
      return;
    }
    const id = window.setTimeout(() => {
      instance.fitView({ padding: fitViewPadding, includeHiddenNodes: true });
    }, 16);
    return () => {
      window.clearTimeout(id);
    };
  }, [instance, resolvedModel, autoFit, fitViewPadding]);

  const containerStyle: CSSProperties = {
    height: typeof height === 'number' ? `${height}px` : height,
    background: mergedTheme.surface
  };

  const showEmptyState = !loading && !error && (!resolvedModel || resolvedModel.nodes.length === 0);
  const filteredEmpty =
    !loading &&
    !error &&
    Boolean(model && model.nodes.length === 0 && (model.filtersApplied || model.searchApplied));
  const controlsDisabled = !interactive || !instance || !hasRenderableNodes;

  let tooltipStyle: CSSProperties | undefined;
  if (tooltip && containerRef.current) {
    const bounds = containerRef.current.getBoundingClientRect();
    const offset = 18;
    const margin = 12;
    const maxWidth = 260;
    const maxHeight = 220;
    const proposedLeft = tooltip.position.x + offset;
    const proposedTop = tooltip.position.y + offset;
    const left = Math.min(
      Math.max(margin, proposedLeft),
      Math.max(margin, bounds.width - maxWidth)
    );
    const top = Math.min(
      Math.max(margin, proposedTop),
      Math.max(margin, bounds.height - maxHeight)
    );
    tooltipStyle = { left, top };
  }

  return (
    <WorkflowGraphCanvasThemeContext.Provider value={mergedTheme}>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-3xl border border-slate-200/70 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:border-slate-700/60 dark:bg-slate-950/40"
        style={containerStyle}
        tabIndex={0}
        role="region"
        aria-label="Workflow topology graph canvas"
        onKeyDown={handleCanvasKeyDown}
        onMouseLeave={handleContainerMouseLeave}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 text-sm font-semibold text-slate-500 dark:bg-slate-950/60 dark:text-slate-300">
            Rendering workflow topology…
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/80 p-6 text-center text-sm text-rose-600 dark:bg-slate-950/70 dark:text-rose-300">
            <p>Unable to render workflow topology.</p>
            <p className="text-xs text-rose-500/80 dark:text-rose-200/80">{error}</p>
          </div>
        )}
        {showEmptyState && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/70 p-6 text-center text-sm text-slate-500 dark:bg-slate-950/60 dark:text-slate-300">
            {filteredEmpty ? (
              <>
                <p>No matches for the current filters.</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Adjust the search or filter selections to reveal workflow topology nodes.
                </p>
              </>
            ) : (
              <>
                <p>No workflow topology data available yet.</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Define workflows, triggers, and assets to populate the explorer.
                </p>
              </>
            )}
          </div>
        )}
        {tooltip && tooltipStyle && (
          <div
            className="pointer-events-none absolute z-30 w-64 max-w-[260px] rounded-2xl bg-slate-900/95 px-4 py-3 text-xs font-semibold text-slate-100 shadow-[0_18px_40px_-22px_rgba(15,23,42,0.9)]"
            style={tooltipStyle}
            role="presentation"
            aria-hidden="true"
          >
            <p className="text-sm font-semibold text-white">{tooltip.node.label}</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-violet-200/80">
              {describeNodeKind(tooltip.node.kind)}
            </p>
            {tooltip.node.subtitle && (
              <p className="mt-1 text-[11px] text-slate-200/80">{tooltip.node.subtitle}</p>
            )}
            {tooltip.node.badges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tooltip.node.badges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center rounded-full bg-violet-500/15 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-violet-200"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
            {tooltip.node.meta.length > 0 && (
              <ul className="mt-2 space-y-1 text-[11px] font-normal text-slate-200/80">
                {tooltip.node.meta.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ReactFlow
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          nodeTypes={NODE_TYPES}
          className="h-full w-full"
          onInit={setInstance}
          onNodeClick={(_, node) => {
            if (!interactive) {
              return;
            }
            const nodeData = node.data as WorkflowGraphCanvasNodeData | undefined;
            if (nodeData) {
              handleNodeSelect(node.id, nodeData);
            }
          }}
          fitView={false}
          panOnDrag={interactive}
          panOnScroll={interactive}
          zoomOnScroll={interactive}
          zoomOnPinch={interactive}
          zoomActivationKeyCode=" "
          zoomOnDoubleClick={interactive}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesFocusable
          selectionOnDrag={false}
          onlyRenderVisibleElements={false}
          onNodeMouseEnter={handleNodeMouseEnter}
          onNodeMouseMove={handleNodeMouseMove}
          onNodeMouseLeave={handleNodeMouseLeave}
          onPaneClick={() => {
            setTooltip(null);
            onCanvasClick?.();
          }}
        >
          <Background color={mergedTheme.gridColor} gap={26} size={1} />
          <Panel
            position="bottom-right"
            className="flex flex-col gap-2 rounded-2xl border border-slate-200/60 bg-white/85 p-2 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/70"
          >
            <div className="grid grid-cols-3 gap-1">
              <span aria-hidden="true" />
              <button
                type="button"
                className={CONTROL_BUTTON_CLASS}
                onClick={() => panBy(0, 160)}
                disabled={controlsDisabled}
                aria-label="Pan up"
              >
                ^
              </button>
              <span aria-hidden="true" />
              <button
                type="button"
                className={CONTROL_BUTTON_CLASS}
                onClick={() => panBy(160, 0)}
                disabled={controlsDisabled}
                aria-label="Pan left"
              >
                {'<'}
              </button>
              <button
                type="button"
                className={CONTROL_BUTTON_CLASS}
                onClick={() => panBy(0, -160)}
                disabled={controlsDisabled}
                aria-label="Pan down"
              >
                v
              </button>
              <button
                type="button"
                className={CONTROL_BUTTON_CLASS}
                onClick={() => panBy(-160, 0)}
                disabled={controlsDisabled}
                aria-label="Pan right"
              >
                {'>'}
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={CONTROL_BUTTON_WIDE_CLASS}
                onClick={handleZoomOut}
                disabled={controlsDisabled}
                aria-label="Zoom out"
              >
                -
              </button>
              <button
                type="button"
                className={CONTROL_BUTTON_WIDE_CLASS}
                onClick={handleZoomIn}
                disabled={controlsDisabled}
                aria-label="Zoom in"
              >
                +
              </button>
              <button
                type="button"
                className={CONTROL_BUTTON_WIDE_CLASS}
                onClick={handleFitView}
                disabled={controlsDisabled}
                aria-label="Reset view"
              >
                Fit
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </WorkflowGraphCanvasThemeContext.Provider>
  );
}

export default WorkflowGraphCanvas;

export type { WorkflowGraphCanvasTheme, WorkflowGraphCanvasThemeOverrides, WorkflowGraphCanvasNodeData };
