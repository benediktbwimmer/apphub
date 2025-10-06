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
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeMouseHandler,
  type ReactFlowInstance,
  type Viewport
} from 'reactflow';
import 'reactflow/dist/style.css';
import { unstable_batchedUpdates } from 'react-dom';
import { useTheme } from '../../theme';
import { getStatusToneClasses } from '../../theme/statusTokens';
import {
  createWorkflowGraphTheme,
  type WorkflowGraphCanvasTheme,
  type WorkflowGraphCanvasThemeOverrides,
  type WorkflowGraphCanvasNodeTheme
} from '../../theme/integrations/workflowGraphTheme';
import {
  buildWorkflowGraphCanvasModel,
  type WorkflowGraphCanvasSelection,
  type WorkflowGraphCanvasFilters,
  type WorkflowGraphCanvasLayoutConfig,
  type WorkflowGraphCanvasNodeKind,
  type WorkflowGraphCanvasEdgeKind,
  type WorkflowGraphCanvasModel,
  type WorkflowGraphCanvasNode,
  type WorkflowGraphLayoutSnapshot
} from '../graph/canvasModel';
import type { WorkflowGraphLiveOverlay, WorkflowGraphNormalized } from '../graph';

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

declare global {
  interface Window {
    __apphubExposeTopologyInstance?: boolean;
    __apphubTopologyReactFlowInstance?: ReactFlowInstance | null;
    __apphubTopologyReactFlowInstanceViewport?: Viewport;
    __apphubViewportAutoFitCount?: number;
  }
}

type GraphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type RenderGraph = {
  nodes: Node<WorkflowGraphCanvasNodeData>[];
  edges: Edge<WorkflowGraphCanvasEdgeData>[];
  bounds: GraphBounds | null;
  structureSignature: string;
};

function arraysShallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function nodeStatusEqual(
  a: WorkflowGraphCanvasNodeData['status'],
  b: WorkflowGraphCanvasNodeData['status']
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.label === b.label && a.tone === b.tone && a.tooltip === b.tooltip;
}

function areNodeDataEqual(
  prev: WorkflowGraphCanvasNodeData,
  next: WorkflowGraphCanvasNodeData
): boolean {
  return (
    prev.label === next.label &&
    prev.subtitle === next.subtitle &&
    prev.kind === next.kind &&
    prev.refId === next.refId &&
    prev.highlighted === next.highlighted &&
    nodeStatusEqual(prev.status, next.status) &&
    arraysShallowEqual(prev.meta, next.meta) &&
    arraysShallowEqual(prev.badges, next.badges)
  );
}

function areNodeStylesEqual(
  prev: Node<WorkflowGraphCanvasNodeData>['style'],
  next: Node<WorkflowGraphCanvasNodeData>['style']
): boolean {
  if (prev === next) {
    return true;
  }
  const prevWidth = prev?.width ?? null;
  const prevHeight = prev?.height ?? null;
  const nextWidth = next?.width ?? null;
  const nextHeight = next?.height ?? null;
  return prevWidth === nextWidth && prevHeight === nextHeight;
}

function edgeLabelsEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>['label'],
  next: Edge<WorkflowGraphCanvasEdgeData>['label']
): boolean {
  if (prev === next) {
    return true;
  }
  if (typeof prev === 'string' && typeof next === 'string') {
    return prev === next;
  }
  return false;
}

function edgeMarkerEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>['markerEnd'],
  next: Edge<WorkflowGraphCanvasEdgeData>['markerEnd']
): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return false;
  }
  return (
    prev.type === next.type &&
    prev.color === next.color &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

function edgeStyleEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>['style'],
  next: Edge<WorkflowGraphCanvasEdgeData>['style']
): boolean {
  if (prev === next) {
    return true;
  }
  const prevStroke = prev?.stroke ?? null;
  const prevWidth = prev?.strokeWidth ?? null;
  const prevDash = prev?.strokeDasharray ?? null;
  const prevOpacity = prev?.opacity ?? null;
  const nextStroke = next?.stroke ?? null;
  const nextWidth = next?.strokeWidth ?? null;
  const nextDash = next?.strokeDasharray ?? null;
  const nextOpacity = next?.opacity ?? null;
  return (
    prevStroke === nextStroke &&
    prevWidth === nextWidth &&
    prevDash === nextDash &&
    prevOpacity === nextOpacity
  );
}

function edgeBgPaddingEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>['labelBgPadding'],
  next: Edge<WorkflowGraphCanvasEdgeData>['labelBgPadding']
): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return false;
  }
  return prev[0] === next[0] && prev[1] === next[1];
}

function edgeLabelBgStyleEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>['labelBgStyle'],
  next: Edge<WorkflowGraphCanvasEdgeData>['labelBgStyle']
): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return false;
  }
  return prev.fill === next.fill && prev.stroke === next.stroke;
}

function edgeLabelStyleEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>['labelStyle'],
  next: Edge<WorkflowGraphCanvasEdgeData>['labelStyle']
): boolean {
  if (prev === next) {
    return true;
  }
  if (!prev || !next) {
    return false;
  }
  return prev.fill === next.fill && prev.fontSize === next.fontSize && prev.fontWeight === next.fontWeight;
}

function areEdgePropsEqual(
  prev: Edge<WorkflowGraphCanvasEdgeData>,
  next: Edge<WorkflowGraphCanvasEdgeData>
): boolean {
  return (
    prev.type === next.type &&
    prev.animated === next.animated &&
    edgeLabelsEqual(prev.label, next.label) &&
    edgeStyleEqual(prev.style, next.style) &&
    edgeMarkerEqual(prev.markerEnd, next.markerEnd) &&
    edgeBgPaddingEqual(prev.labelBgPadding, next.labelBgPadding) &&
    prev.labelBgBorderRadius === next.labelBgBorderRadius &&
    edgeLabelBgStyleEqual(prev.labelBgStyle, next.labelBgStyle) &&
    edgeLabelStyleEqual(prev.labelStyle, next.labelStyle) &&
    prev.data.kind === next.data.kind &&
    prev.data.highlighted === next.data.highlighted
  );
}

function computeViewportBounds(viewport: Viewport, width: number, height: number): GraphBounds {
  const graphMinX = (-viewport.x) / viewport.zoom;
  const graphMinY = (-viewport.y) / viewport.zoom;
  const graphMaxX = graphMinX + width / viewport.zoom;
  const graphMaxY = graphMinY + height / viewport.zoom;
  return {
    minX: graphMinX,
    minY: graphMinY,
    maxX: graphMaxX,
    maxY: graphMaxY
  };
}

function computeInstanceBounds(instance: ReactFlowInstance | null): GraphBounds | null {
  if (!instance) {
    return null;
  }
  const nodes = instance.getNodes();
  if (!nodes || nodes.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const measured = (node as typeof node & { measured?: { width?: number; height?: number } }).measured;
    const width = measured?.width ?? node.width ?? 0;
    const height = measured?.height ?? node.height ?? 0;
    const base = node.positionAbsolute ?? node.position ?? { x: 0, y: 0 };
    const nodeMinX = base.x;
    const nodeMinY = base.y;
    const nodeMaxX = base.x + width;
    const nodeMaxY = base.y + height;
    if (!Number.isFinite(nodeMinX) || !Number.isFinite(nodeMinY) || !Number.isFinite(nodeMaxX) || !Number.isFinite(nodeMaxY)) {
      continue;
    }
    if (nodeMinX < minX) {
      minX = nodeMinX;
    }
    if (nodeMinY < minY) {
      minY = nodeMinY;
    }
    if (nodeMaxX > maxX) {
      maxX = nodeMaxX;
    }
    if (nodeMaxY > maxY) {
      maxY = nodeMaxY;
    }
  }

  if (minX === Number.POSITIVE_INFINITY || minY === Number.POSITIVE_INFINITY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function boundsIntersect(a: GraphBounds | null, b: GraphBounds | null): boolean {
  if (!a || !b) {
    return false;
  }
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

const WorkflowGraphCanvasThemeContext = createContext<WorkflowGraphCanvasTheme | null>(null);

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 32;
const UNBOUNDED_TRANSLATE_EXTENT: [[number, number], [number, number]] = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
];

const INVISIBLE_HANDLE_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: '9999px',
  border: 0,
  background: 'transparent',
  opacity: 0,
  pointerEvents: 'none'
};

function serializeFilters(filters?: WorkflowGraphCanvasFilters): string {
  if (!filters) {
    return '';
  }
  return Object.entries(filters)
    .map(([key, values]) => `${key}:${[...values].sort().join('|')}`)
    .sort()
    .join(';');
}

function serializeSelection(selection?: WorkflowGraphCanvasSelection): string {
  if (!selection) {
    return '';
  }
  const entries: string[] = [];
  if (selection.workflowId) {
    entries.push(`workflow:${selection.workflowId}`);
  }
  if (selection.stepId) {
    entries.push(`step:${selection.stepId}`);
  }
  if (selection.triggerId) {
    entries.push(`trigger:${selection.triggerId}`);
  }
  if (selection.assetNormalizedId) {
    entries.push(`asset:${selection.assetNormalizedId}`);
  }
  return entries.sort().join(';');
}

function useWorkflowGraphCanvasTheme(): WorkflowGraphCanvasTheme {
  const theme = useContext(WorkflowGraphCanvasThemeContext);
  if (!theme) {
    throw new Error('WorkflowGraphCanvasThemeContext missing provider');
  }
  return theme;
}


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
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-subtle bg-surface-glass px-1.5 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const CONTROL_BUTTON_WIDE_CLASS =
  'inline-flex h-8 items-center justify-center rounded-md border border-subtle bg-surface-glass px-2 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PANEL_CONTAINER_CLASSES =
  'flex flex-col gap-2 rounded-2xl border border-subtle bg-surface-glass p-2 shadow-elevation-lg backdrop-blur-md transition-colors';

const OVERLAY_BASE_CLASSES = 'absolute inset-0 z-10 flex items-center justify-center text-scale-sm font-weight-semibold';

const LOADING_OVERLAY_CLASSES = `${OVERLAY_BASE_CLASSES} bg-surface-glass-soft text-secondary`;

const ERROR_OVERLAY_CLASSES =
  'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-glass p-6 text-center text-scale-sm text-status-danger';

const ERROR_OVERLAY_SUBTEXT_CLASSES = 'text-scale-xs text-status-danger';

const EMPTY_OVERLAY_CLASSES =
  'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface-glass p-6 text-center text-scale-sm text-secondary';

const EMPTY_OVERLAY_SUBTEXT_CLASSES = 'text-scale-xs text-muted';

const TOOLTIP_CONTAINER_CLASSES =
  'pointer-events-none absolute z-30 w-64 max-w-[260px] rounded-2xl border border-subtle bg-surface-sunken px-4 py-3 text-scale-xs font-weight-semibold text-inverse shadow-elevation-xl';

const TOOLTIP_KIND_CLASSES = 'mt-1 text-[10px] uppercase tracking-[0.22em] text-accent';

const TOOLTIP_SUBTITLE_CLASSES = 'mt-1 text-[11px] text-secondary';

const TOOLTIP_BADGE_CLASSES =
  'inline-flex items-center rounded-full bg-accent-soft px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-wide text-accent';

const TOOLTIP_META_LIST_CLASSES = 'mt-2 space-y-1 text-[11px] font-weight-regular text-secondary';

const STATUS_BADGE_BASE_CLASSES =
  'inline-flex max-w-[140px] items-center justify-center rounded-full border px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-wide';

const PRIMARY_BADGE_CLASSES =
  'inline-flex max-w-[120px] items-center justify-center rounded-full px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-wide';

const SECONDARY_BADGE_CLASSES =
  'inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-weight-semibold uppercase tracking-wide';

const NODE_CONTAINER_BASE_CLASSES =
  'flex h-full w-full flex-col justify-between rounded-2xl border p-4 text-left transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const NODE_CONTAINER_BACKGROUND_CLASSES = 'bg-surface-glass';

const NODE_HIGHLIGHT_CLASSES = 'ring-2 ring-accent shadow-elevation-md';

const CANVAS_CONTAINER_CLASSES =
  'relative overflow-hidden rounded-3xl border border-subtle bg-surface-glass shadow-elevation-xl backdrop-blur-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function WorkflowGraphNode({ data, selected }: NodeProps<WorkflowGraphCanvasNodeData>) {
  const theme = useWorkflowGraphCanvasTheme();
  const variant = theme.nodes[data.kind];
  const isHighlighted = data.highlighted || selected;
  const status = data.status;
  const statusClassName = status ? STATUS_BADGE_TONE_CLASSES[status.tone] ?? STATUS_BADGE_TONE_CLASSES.neutral : null;
  const primaryBadge = !status && data.badges.length > 0 ? data.badges[0] : null;
  const secondaryBadges = status ? data.badges : data.badges.slice(primaryBadge ? 1 : 0);
  return (
    <div
      className={classNames(
        NODE_CONTAINER_BASE_CLASSES,
        NODE_CONTAINER_BACKGROUND_CLASSES,
        isHighlighted ? NODE_HIGHLIGHT_CLASSES : 'ring-0'
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
            className={classNames(STATUS_BADGE_BASE_CLASSES, statusClassName)}
            title={status.tooltip ?? status.label}
          >
            {status.label}
          </span>
        ) : primaryBadge ? (
          <span
            className={PRIMARY_BADGE_CLASSES}
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
              className={SECONDARY_BADGE_CLASSES}
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

const STATUS_BADGE_TONE_CLASSES: Record<
  NonNullable<WorkflowGraphCanvasNodeData['status']>['tone'],
  string
> = {
  neutral: getStatusToneClasses('neutral'),
  info: getStatusToneClasses('info'),
  success: getStatusToneClasses('success'),
  warning: getStatusToneClasses('warning'),
  danger: getStatusToneClasses('danger')
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
  fullscreen?: {
    isActive: boolean;
    onToggle: () => void;
    supported?: boolean;
    label?: string;
  };
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
  overlay = null,
  fullscreen
}: WorkflowGraphCanvasProps) {
  const { theme: activeTheme } = useTheme();
  const baseTheme = useMemo<WorkflowGraphCanvasTheme>(
    () => createWorkflowGraphTheme(activeTheme),
    [activeTheme]
  );
  const mergedTheme = useMemo(() => mergeTheme(baseTheme, theme), [baseTheme, theme]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<WorkflowGraphCanvasTooltip | null>(null);
  const shouldAutoFitRef = useRef(true);
  const filtersSignatureRef = useRef<string>('');
  const selectionSignatureRef = useRef<string>('');
  const searchSignatureRef = useRef<string | null>(null);
  const layoutSnapshotRef = useRef<{ signature: string | null; positions: WorkflowGraphLayoutSnapshot }>(
    {
      signature: null,
      positions: new Map()
    }
  );

  const model = useMemo(() => {
    if (!graph) {
      return null;
    }
    const snapshot = layoutSnapshotRef.current;
    return buildWorkflowGraphCanvasModel(graph, {
      layout,
      selection,
      filters,
      searchTerm,
      overlay,
      previousStructureSignature: snapshot.signature,
      previousLayout: snapshot.positions
    });
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

  const renderGraph = useMemo<RenderGraph | null>(() => {
    if (!resolvedModel) {
      return null;
    }
    return buildRenderGraph(resolvedModel, mergedTheme, handleNodeSelect, onNodeSelect);
  }, [resolvedModel, mergedTheme, handleNodeSelect, onNodeSelect]);

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowGraphCanvasNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<WorkflowGraphCanvasEdgeData>([]);
  const reactFlow = useReactFlow<WorkflowGraphCanvasNodeData, WorkflowGraphCanvasEdgeData>();

  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const layoutBoundsRef = useRef<GraphBounds | null>(null);
  const structureSignatureRef = useRef<string | null>(null);
  const pendingStructuralGraphRef = useRef<RenderGraph | null>(null);
  const structuralSwapHandleRef = useRef<number | null>(null);
  const viewportRefreshHandleRef = useRef<number | null>(null);
  const suppressMoveEndRef = useRef(false);
  const userInteractedRef = useRef(false);
  const initialViewportAppliedRef = useRef(false);
  const interactive = interactionMode === 'interactive';

  const scheduleNodeInternalsUpdate = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const uniqueIds = Array.from(new Set(ids));
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          uniqueIds.forEach((id) => {
            reactFlow.updateNodeInternals(id);
          });
        });
      } else {
        uniqueIds.forEach((id) => {
          reactFlow.updateNodeInternals(id);
        });
      }
    },
    [reactFlow]
  );

  const updateLayoutSnapshot = useCallback((graph: RenderGraph) => {
    layoutSnapshotRef.current = {
      signature: graph.structureSignature,
      positions: new Map(
        graph.nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }])
      )
    } satisfies { signature: string | null; positions: WorkflowGraphLayoutSnapshot };
  }, []);

  const applyRenderGraphDiff = useCallback(
    (graph: RenderGraph) => {
      const nextNodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
      const changedNodeIds: string[] = [];

      setNodes((currentNodes) => {
        let mutated = false;
        const updatedNodes = currentNodes.map((node) => {
          const next = nextNodeMap.get(node.id);
          if (!next) {
            return node;
          }
          const dataChanged = !areNodeDataEqual(node.data, next.data);
          const styleChanged = !areNodeStylesEqual(node.style, next.style);
          if (!dataChanged && !styleChanged) {
            return node;
          }
          mutated = true;
          changedNodeIds.push(node.id);
          return {
            ...node,
            data: next.data,
            style: next.style
          } satisfies Node<WorkflowGraphCanvasNodeData>;
        });
        return mutated ? updatedNodes : currentNodes;
      });

      if (changedNodeIds.length > 0) {
        scheduleNodeInternalsUpdate(changedNodeIds);
      }

      const nextEdgeMap = new Map(graph.edges.map((edge) => [edge.id, edge]));
      setEdges((currentEdges) => {
        let mutated = false;
        const updatedEdges = currentEdges.map((edge) => {
          const next = nextEdgeMap.get(edge.id);
          if (!next) {
            return edge;
          }
          if (areEdgePropsEqual(edge, next)) {
            return edge;
          }
          mutated = true;
          return {
            ...edge,
            data: next.data,
            label: next.label,
            animated: next.animated,
            style: next.style,
            markerEnd: next.markerEnd,
            labelBgPadding: next.labelBgPadding,
            labelBgBorderRadius: next.labelBgBorderRadius,
            labelBgStyle: next.labelBgStyle,
            labelStyle: next.labelStyle,
            type: next.type
          } satisfies Edge<WorkflowGraphCanvasEdgeData>;
        });
        return mutated ? updatedEdges : currentEdges;
      });
    },
    [scheduleNodeInternalsUpdate, setEdges, setNodes]
  );

  const hasRenderableNodes = nodes.length > 0;
  const showLoadingOverlay = loading && !hasRenderableNodes;
  const showErrorOverlay = Boolean(error && !loading && !hasRenderableNodes);

  const persistViewport = useCallback((viewport: Viewport) => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage?.setItem('apphub.workflowTopology.viewport.v1', JSON.stringify(viewport));
    } catch (err) {
      console.warn('workflow.graph.viewport_persist_failed', err);
    }
  }, []);

  const ensureViewportHasContent = useCallback(
    (
      {
        force = false,
        immediate = false,
        delayMs = 0,
        targetInstance = null
      }: { force?: boolean; immediate?: boolean; delayMs?: number; targetInstance?: ReactFlowInstance | null } = {}
    ) => {
      const flow = targetInstance ?? instance;
      if (!flow) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const containerBounds = container.getBoundingClientRect();
      if (containerBounds.width === 0 || containerBounds.height === 0) {
        return;
      }
      const nodeBounds = layoutBoundsRef.current ?? computeInstanceBounds(flow);
      if (!nodeBounds) {
        return;
      }
      const viewportBounds = computeViewportBounds(
        flow.getViewport(),
        containerBounds.width,
        containerBounds.height
      );
      const shouldFit = force || !boundsIntersect(nodeBounds, viewportBounds);
      if (!shouldFit) {
        return;
      }
      const executeFit = (targetFlow: ReactFlowInstance) => {
        const currentContainer = containerRef.current;
        if (!currentContainer) {
          return;
        }
        if (typeof window !== 'undefined' && window.__apphubExposeTopologyInstance) {
          window.__apphubViewportAutoFitCount = (window.__apphubViewportAutoFitCount ?? 0) + 1;
        }
        suppressMoveEndRef.current = true;
        targetFlow.fitView({
          padding: fitViewPadding,
          includeHiddenNodes: false,
          duration: immediate ? 0 : 220
        });
        shouldAutoFitRef.current = false;
      };

      const scheduleFit = (targetFlow: ReactFlowInstance) => {
        if (immediate) {
          executeFit(targetFlow);
        } else {
          if (typeof window !== 'undefined') {
            window.requestAnimationFrame(() => executeFit(targetFlow));
          } else {
            executeFit(targetFlow);
          }
        }
      };

      if (typeof window !== 'undefined' && delayMs > 0) {
        window.setTimeout(() => scheduleFit(flow), delayMs);
      } else {
        scheduleFit(flow);
      }
    },
    [fitViewPadding, instance]
  );

  const scheduleStructuralSwap = useCallback(
    (graph: RenderGraph) => {
      pendingStructuralGraphRef.current = graph;
      if (typeof window !== 'undefined' && structuralSwapHandleRef.current !== null) {
        window.cancelAnimationFrame(structuralSwapHandleRef.current);
      }

      const executeSwap = () => {
        structuralSwapHandleRef.current = null;
        const pending = pendingStructuralGraphRef.current;
        pendingStructuralGraphRef.current = null;
        if (!pending) {
          return;
        }

        unstable_batchedUpdates(() => {
          setNodes(pending.nodes);
          setEdges(pending.edges);
        });

        layoutBoundsRef.current = pending.bounds;
        structureSignatureRef.current = pending.structureSignature;
        updateLayoutSnapshot(pending);

        const shouldForce = shouldAutoFitRef.current || !userInteractedRef.current;
        const immediate = shouldForce && !userInteractedRef.current;

        if (typeof window !== 'undefined') {
          if (viewportRefreshHandleRef.current !== null) {
            window.cancelAnimationFrame(viewportRefreshHandleRef.current);
          }
          viewportRefreshHandleRef.current = window.requestAnimationFrame(() => {
            viewportRefreshHandleRef.current = null;
            ensureViewportHasContent({
              force: shouldForce,
              immediate,
              delayMs: shouldForce ? 60 : 0,
              targetInstance: instance
            });
          });
        } else {
          ensureViewportHasContent({
            force: shouldForce,
            immediate,
            delayMs: 0,
            targetInstance: instance
          });
        }
      };

      if (typeof window !== 'undefined') {
        structuralSwapHandleRef.current = window.requestAnimationFrame(executeSwap);
      } else {
        executeSwap();
      }
    },
    [ensureViewportHasContent, instance, setEdges, setNodes, updateLayoutSnapshot]
  );

  useEffect(() => {
    if (!renderGraph) {
      return;
    }

    layoutBoundsRef.current = renderGraph.bounds;
    const previousSignature = structureSignatureRef.current;
    const structureChanged = previousSignature !== renderGraph.structureSignature;

    if (structureChanged) {
      scheduleStructuralSwap(renderGraph);
      return;
    }

    structureSignatureRef.current = renderGraph.structureSignature;
    updateLayoutSnapshot(renderGraph);
    applyRenderGraphDiff(renderGraph);
  }, [renderGraph, scheduleStructuralSwap, applyRenderGraphDiff, updateLayoutSnapshot]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        if (structuralSwapHandleRef.current !== null) {
          window.cancelAnimationFrame(structuralSwapHandleRef.current);
        }
        if (viewportRefreshHandleRef.current !== null) {
          window.cancelAnimationFrame(viewportRefreshHandleRef.current);
        }
      }
      pendingStructuralGraphRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!instance || initialViewportAppliedRef.current) {
      return;
    }
    let storedViewport: Viewport | null = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage?.getItem('apphub.workflowTopology.viewport.v1');
        if (raw) {
          const parsed = JSON.parse(raw) as Viewport;
          if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y) && Number.isFinite(parsed.zoom)) {
            storedViewport = parsed;
          }
        }
      } catch (err) {
        console.warn('workflow.graph.viewport_restore_failed', err);
      }
    }
    if (storedViewport) {
      suppressMoveEndRef.current = true;
      instance.setViewport(storedViewport, { duration: 0 });
    }
    initialViewportAppliedRef.current = true;
  }, [instance]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.__apphubExposeTopologyInstance) {
        window.__apphubTopologyReactFlowInstance = null;
        window.__apphubTopologyReactFlowInstanceViewport = undefined;
        window.__apphubViewportAutoFitCount = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (!instance) {
      return;
    }
    if (!shouldAutoFitRef.current) {
      return;
    }
    if (nodes.length === 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      ensureViewportHasContent({ force: true, immediate: true, delayMs: 60 });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [ensureViewportHasContent, instance, nodes]);

  useEffect(() => {
    if (!autoFit) {
      return;
    }
    const nextFiltersSignature = serializeFilters(filters);
    const nextSelectionSignature = serializeSelection(selection);
    const nextSearchSignature = searchTerm ?? null;

    if (
      shouldAutoFitRef.current === false &&
      (filtersSignatureRef.current !== nextFiltersSignature ||
        selectionSignatureRef.current !== nextSelectionSignature ||
        searchSignatureRef.current !== nextSearchSignature)
    ) {
      shouldAutoFitRef.current = true;
    }

    filtersSignatureRef.current = nextFiltersSignature;
    selectionSignatureRef.current = nextSelectionSignature;
    searchSignatureRef.current = nextSearchSignature;
  }, [autoFit, filters, selection, searchTerm]);

  useEffect(() => {
    if (!autoFit) {
      return;
    }
    if (!resolvedModel || resolvedModel.nodes.length > 0) {
      return;
    }
    shouldAutoFitRef.current = true;
  }, [autoFit, resolvedModel]);

  const panBy = useCallback(
    (deltaX: number, deltaY: number, duration = 160) => {
      if (!instance) {
        return;
      }
      userInteractedRef.current = true;
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
    if (!instance) {
      return;
    }
    userInteractedRef.current = true;
    instance.zoomIn({ duration: 140 });
  }, [instance]);

  const handleZoomOut = useCallback(() => {
    if (!instance) {
      return;
    }
    userInteractedRef.current = true;
    instance.zoomOut({ duration: 140 });
  }, [instance]);

  const handleFitView = useCallback(() => {
    if (!instance) {
      return;
    }
    userInteractedRef.current = true;
    instance.fitView({ padding: fitViewPadding, includeHiddenNodes: false });
  }, [instance, fitViewPadding]);

  const handleMoveEnd = useCallback(
    (_: unknown, viewport: Viewport) => {
      persistViewport(viewport);
      if (typeof window !== 'undefined' && window.__apphubExposeTopologyInstance) {
        window.__apphubTopologyReactFlowInstanceViewport = viewport;
      }
      if (suppressMoveEndRef.current) {
        suppressMoveEndRef.current = false;
        return;
      }
      userInteractedRef.current = true;
    },
    [persistViewport]
  );

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
            instance.fitView({ padding: fitViewPadding, includeHiddenNodes: false });
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
  const fullscreenSupported = fullscreen?.supported ?? true;
  const fullscreenActive = fullscreen?.isActive ?? false;
  const fullscreenLabel = fullscreen?.label ?? (fullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen');
  const showFullscreenButton = Boolean(fullscreen?.onToggle) && fullscreenSupported;

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
        className={CANVAS_CONTAINER_CLASSES}
        style={containerStyle}
        tabIndex={0}
        role="region"
        aria-label="Workflow topology graph canvas"
        onKeyDown={handleCanvasKeyDown}
        onMouseLeave={handleContainerMouseLeave}
      >
        {showLoadingOverlay && (
          <div className={LOADING_OVERLAY_CLASSES}>
            Rendering workflow topology…
          </div>
        )}
        {showErrorOverlay && (
          <div
            data-testid="workflow-topology-error-overlay"
            className={ERROR_OVERLAY_CLASSES}
          >
            <p>Unable to render workflow topology.</p>
            <p className={ERROR_OVERLAY_SUBTEXT_CLASSES}>{error}</p>
          </div>
        )}
        {showEmptyState && (
          <div className={EMPTY_OVERLAY_CLASSES}>
            {filteredEmpty ? (
              <>
                <p>No matches for the current filters.</p>
                <p className={EMPTY_OVERLAY_SUBTEXT_CLASSES}>
                  Adjust the search or filter selections to reveal workflow topology nodes.
                </p>
              </>
            ) : (
              <>
                <p>No workflow topology data available yet.</p>
                <p className={EMPTY_OVERLAY_SUBTEXT_CLASSES}>
                  Define workflows, triggers, and assets to populate the explorer.
                </p>
              </>
            )}
          </div>
        )}
        {tooltip && tooltipStyle && (
          <div
            className={TOOLTIP_CONTAINER_CLASSES}
            style={tooltipStyle}
            role="presentation"
            aria-hidden="true"
          >
            <p className="text-scale-sm font-weight-semibold text-inverse">{tooltip.node.label}</p>
            <p className={TOOLTIP_KIND_CLASSES}>
              {describeNodeKind(tooltip.node.kind)}
            </p>
            {tooltip.node.subtitle && (
              <p className={TOOLTIP_SUBTITLE_CLASSES}>{tooltip.node.subtitle}</p>
            )}
            {tooltip.node.badges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tooltip.node.badges.map((badge) => (
                  <span
                    key={badge}
                    className={TOOLTIP_BADGE_CLASSES}
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
            {tooltip.node.meta.length > 0 && (
              <ul className={TOOLTIP_META_LIST_CLASSES}>
                {tooltip.node.meta.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={NODE_TYPES}
          className="h-full w-full"
          onInit={(nextInstance) => {
            setInstance(nextInstance);
            if (typeof window !== 'undefined' && window.__apphubExposeTopologyInstance) {
              window.__apphubTopologyReactFlowInstance = nextInstance;
              window.__apphubTopologyReactFlowInstanceViewport = nextInstance.getViewport();
            }
          if (shouldAutoFitRef.current) {
            ensureViewportHasContent({
              force: true,
              immediate: true,
              delayMs: 60,
              targetInstance: nextInstance
            });
          }
          }}
          onMoveEnd={handleMoveEnd}
          onNodeClick={(_, node) => {
            if (!onNodeSelect) {
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
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          translateExtent={UNBOUNDED_TRANSLATE_EXTENT}
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
          <Panel position="bottom-right" className={PANEL_CONTAINER_CLASSES}>
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
              {showFullscreenButton && (
                <button
                  type="button"
                  className={CONTROL_BUTTON_WIDE_CLASS}
                  onClick={fullscreen!.onToggle}
                  aria-label={fullscreenLabel}
                >
                  {fullscreenActive ? '⤫' : '⤢'}
                </button>
              )}
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </WorkflowGraphCanvasThemeContext.Provider>
  );
}

export default WorkflowGraphCanvas;

export type { WorkflowGraphCanvasTheme, WorkflowGraphCanvasThemeOverrides, WorkflowGraphCanvasNodeData };

function computeModelBounds(modelNodes: WorkflowGraphCanvasNode[]): GraphBounds | null {
  if (modelNodes.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of modelNodes) {
    const nodeMinX = node.position.x;
    const nodeMinY = node.position.y;
    const nodeMaxX = node.position.x + node.width;
    const nodeMaxY = node.position.y + node.height;
    if (!Number.isFinite(nodeMinX) || !Number.isFinite(nodeMinY) || !Number.isFinite(nodeMaxX) || !Number.isFinite(nodeMaxY)) {
      continue;
    }
    if (nodeMinX < minX) {
      minX = nodeMinX;
    }
    if (nodeMinY < minY) {
      minY = nodeMinY;
    }
    if (nodeMaxX > maxX) {
      maxX = nodeMaxX;
    }
    if (nodeMaxY > maxY) {
      maxY = nodeMaxY;
    }
  }

  if (minX === Number.POSITIVE_INFINITY || minY === Number.POSITIVE_INFINITY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function buildRenderGraph(
  model: WorkflowGraphCanvasModel,
  theme: WorkflowGraphCanvasTheme,
  handleNodeSelect: (nodeId: string, data: WorkflowGraphCanvasNodeData) => void,
  onNodeSelect?: (nodeId: string, data: WorkflowGraphCanvasNodeData) => void
): RenderGraph {
  const nodes: Node<WorkflowGraphCanvasNodeData>[] = model.nodes.map((node) => ({
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
      onSelect: onNodeSelect ? (payload) => handleNodeSelect(node.id, payload) : undefined
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

  const edges: Edge<WorkflowGraphCanvasEdgeData>[] = model.edges.map((edge) => {
    const dashed =
      edge.kind === 'step-consumes' || edge.kind === 'event-source' || edge.kind === 'step-event-source';
    const stroke = edge.highlighted
      ? theme.edgeHighlight
      : dashed
        ? theme.edgeDashed
        : theme.edgeDefault;
    const label = edge.label
      ? edge.tooltip
        ? (
            <span title={edge.tooltip}>{edge.label}</span>
          )
        : edge.label
      : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        kind: edge.kind,
        highlighted: edge.highlighted
      },
      label,
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
      labelBgStyle: { fill: theme.labelBackground, stroke: theme.edgeMuted },
      labelStyle: { fill: theme.labelText, fontSize: 11, fontWeight: 600 },
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

  return {
    nodes,
    edges,
    bounds: computeModelBounds(model.nodes),
    structureSignature: model.structureSignature
  };
}
