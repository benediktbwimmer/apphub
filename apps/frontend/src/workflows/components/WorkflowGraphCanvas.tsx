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
  type WorkflowGraphCanvasModel
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
      const dashed =
        edge.kind === 'step-consumes' || edge.kind === 'event-source' || edge.kind === 'step-event-source';
      const stroke = edge.highlighted ? mergedTheme.edgeHighlight : dashed ? mergedTheme.edgeDashed : mergedTheme.edgeDefault;
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
  const showLoadingOverlay = loading && !hasRenderableNodes;
  const showErrorOverlay = Boolean(error && !loading && !hasRenderableNodes);

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
    if (!shouldAutoFitRef.current) {
      return;
    }
    const id = window.setTimeout(() => {
      instance.fitView({ padding: fitViewPadding, includeHiddenNodes: true });
    }, 16);
    shouldAutoFitRef.current = false;
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
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          nodeTypes={NODE_TYPES}
          className="h-full w-full"
          onInit={setInstance}
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
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </WorkflowGraphCanvasThemeContext.Provider>
  );
}

export default WorkflowGraphCanvas;

export type { WorkflowGraphCanvasTheme, WorkflowGraphCanvasThemeOverrides, WorkflowGraphCanvasNodeData };
