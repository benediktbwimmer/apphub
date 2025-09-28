import { useEffect, useMemo, useState, createContext, useContext, type CSSProperties } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance
} from 'reactflow';
import 'reactflow/dist/style.css';
import { buildWorkflowGraphCanvasModel, type WorkflowGraphCanvasSelection } from '../graph/canvasModel';
import type { WorkflowGraphNormalized } from '../graph';
import type { WorkflowGraphCanvasNodeKind, WorkflowGraphCanvasEdgeKind } from '../graph/canvasModel';
import type { WorkflowGraphCanvasLayoutConfig } from '../graph/canvasModel';

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
  kind: WorkflowGraphCanvasNodeKind;
  highlighted: boolean;
  onSelect?: (data: WorkflowGraphCanvasNodeData) => void;
};

const WorkflowGraphCanvasThemeContext = createContext<WorkflowGraphCanvasTheme | null>(null);

function useWorkflowGraphCanvasTheme(): WorkflowGraphCanvasTheme {
  const theme = useContext(WorkflowGraphCanvasThemeContext);
  if (!theme) {
    throw new Error('WorkflowGraphCanvasThemeContext missing provider');
  }
  return theme;
}

const DEFAULT_THEME: WorkflowGraphCanvasTheme = {
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

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function WorkflowGraphNode({ data, selected }: NodeProps<WorkflowGraphCanvasNodeData>) {
  const theme = useWorkflowGraphCanvasTheme();
  const variant = theme.nodes[data.kind];
  const isHighlighted = data.highlighted || selected;
  return (
    <div
      className={classNames(
        'flex h-full w-full flex-col justify-between rounded-2xl border bg-white/80 p-4 text-left transition-shadow dark:bg-slate-950/60',
        isHighlighted ? 'ring-2 ring-violet-300 dark:ring-violet-500/60' : 'ring-0'
      )}
      style={{
        background: variant.background,
        borderColor: isHighlighted ? variant.borderHighlighted : variant.border,
        color: variant.text,
        boxShadow: variant.shadow
      }}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect?.(data);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onSelect?.(data);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold leading-5 text-slate-800 dark:text-slate-100">
            {data.label}
          </p>
          {data.subtitle && (
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {data.subtitle}
            </p>
          )}
        </div>
        {data.badges.length > 0 && (
          <span
            className="inline-flex max-w-[120px] items-center justify-center rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: variant.badgeBackground, color: variant.badgeText }}
          >
            {data.badges[0]}
          </span>
        )}
      </div>
      {data.badges.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {data.badges.slice(1).map((badge) => (
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
        <ul className="mt-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
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

type WorkflowGraphCanvasProps = {
  graph: WorkflowGraphNormalized | null;
  loading?: boolean;
  error?: string | null;
  height?: number | string;
  layout?: Partial<WorkflowGraphCanvasLayoutConfig>;
  selection?: WorkflowGraphCanvasSelection;
  theme?: WorkflowGraphCanvasThemeOverrides;
  autoFit?: boolean;
  fitViewPadding?: number;
  onNodeSelect?: (nodeId: string, data: WorkflowGraphCanvasNodeData) => void;
  interactionMode?: 'interactive' | 'static';
};

export function WorkflowGraphCanvas({
  graph,
  loading = false,
  error = null,
  height = 600,
  layout,
  selection,
  theme,
  autoFit = true,
  fitViewPadding = 0.2,
  onNodeSelect,
  interactionMode = 'interactive'
}: WorkflowGraphCanvasProps) {
  const mergedTheme = useMemo(() => mergeTheme(DEFAULT_THEME, theme), [theme]);

  const model = useMemo(() => {
    if (!graph) {
      return null;
    }
    return buildWorkflowGraphCanvasModel(graph, { layout, selection });
  }, [graph, layout, selection]);

  const reactFlowNodes = useMemo<Node<WorkflowGraphCanvasNodeData>[]>(() => {
    if (!model) {
      return [];
    }
    return model.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: {
        id: node.id,
        refId: node.refId,
        label: node.label,
        subtitle: node.subtitle,
        meta: node.meta ?? [],
        badges: node.badges ?? [],
        kind: node.kind,
        highlighted: node.highlighted,
        onSelect: onNodeSelect
          ? (payload) => onNodeSelect(node.id, payload)
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
  }, [model]);

  const reactFlowEdges = useMemo<Edge<WorkflowGraphCanvasEdgeData>[]>(() => {
    if (!model) {
      return [];
    }
    return model.edges.map((edge) => {
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
          strokeWidth: edge.highlighted ? 2.4 : 1.6,
          strokeDasharray: dashed ? '6 4' : undefined
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 18,
          height: 18
        }
      } satisfies Edge<WorkflowGraphCanvasEdgeData>;
    });
  }, [model, mergedTheme.edgeDefault, mergedTheme.edgeDashed, mergedTheme.edgeHighlight, mergedTheme.edgeMuted, mergedTheme.labelBackground, mergedTheme.labelText]);

  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    if (!instance || !model || !autoFit || model.nodes.length === 0) {
      return;
    }
    const id = window.setTimeout(() => {
      instance.fitView({ padding: fitViewPadding, includeHiddenNodes: false });
    }, 16);
    return () => {
      window.clearTimeout(id);
    };
  }, [instance, model, autoFit, fitViewPadding]);

  const containerStyle: CSSProperties = {
    height: typeof height === 'number' ? `${height}px` : height,
    background: mergedTheme.surface
  };

  const showEmptyState = !loading && !error && (!model || model.nodes.length === 0);
  const interactive = interactionMode === 'interactive';

  return (
    <WorkflowGraphCanvasThemeContext.Provider value={mergedTheme}>
      <div
        className="relative overflow-hidden rounded-3xl border border-slate-200/70 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-950/40"
        style={containerStyle}
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
            <p>No workflow topology data available yet.</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Define workflows, triggers, and assets to populate the explorer.
            </p>
          </div>
        )}
        <ReactFlow
          nodes={reactFlowNodes}
          edges={reactFlowEdges}
          nodeTypes={NODE_TYPES}
          className="h-full w-full"
          onInit={setInstance}
          fitView={false}
          panOnDrag={interactive}
          panOnScroll={interactive}
          zoomOnScroll={interactive}
          zoomOnPinch={interactive}
          zoomActivationKeyCode=" "
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesFocusable
          onlyRenderVisibleElements
        >
          <Background color={mergedTheme.gridColor} gap={26} size={1} />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      </div>
    </WorkflowGraphCanvasThemeContext.Provider>
  );
}

export default WorkflowGraphCanvas;

export type { WorkflowGraphCanvasTheme, WorkflowGraphCanvasThemeOverrides, WorkflowGraphCanvasNodeData };
