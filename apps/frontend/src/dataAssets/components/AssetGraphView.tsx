import { useMemo, type JSX } from 'react';
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow';
import dagre from 'dagre';
import type { AssetGraphData } from '../types';
import 'reactflow/dist/style.css';
import { useIsDarkMode } from '../../hooks/useIsDarkMode';

type AssetGraphViewProps = {
  data: AssetGraphData | null;
  selectedAssetId: string | null;
  onSelectAsset: (normalizedAssetId: string) => void;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

type NodeVisualTokens = {
  border: string;
  background: string;
  shadow: string;
};

const LIGHT_NODE_BASE: NodeVisualTokens = {
  border: '1px solid rgba(148, 163, 184, 0.6)',
  background: '#ffffff',
  shadow: '0 18px 32px -24px rgba(15, 23, 42, 0.45)'
};

const LIGHT_NODE_OUTDATED: NodeVisualTokens = {
  border: '2px solid #0ea5e9',
  background: 'rgba(224, 242, 254, 0.65)',
  shadow: '0 22px 40px -28px rgba(14, 165, 233, 0.45)'
};

const LIGHT_NODE_STALE: NodeVisualTokens = {
  border: '2px solid #f97316',
  background: 'rgba(254, 215, 170, 0.35)',
  shadow: '0 22px 40px -28px rgba(249, 115, 22, 0.4)'
};

const DARK_NODE_BASE: NodeVisualTokens = {
  border: '1px solid rgba(148, 163, 184, 0.45)',
  background: 'rgba(15, 23, 42, 0.78)',
  shadow: '0 28px 48px -32px rgba(15, 23, 42, 0.85)'
};

const DARK_NODE_OUTDATED: NodeVisualTokens = {
  border: '2px solid rgba(56, 189, 248, 0.85)',
  background: 'rgba(14, 165, 233, 0.18)',
  shadow: '0 28px 48px -30px rgba(14, 165, 233, 0.55)'
};

const DARK_NODE_STALE: NodeVisualTokens = {
  border: '2px solid rgba(251, 146, 60, 0.85)',
  background: 'rgba(249, 115, 22, 0.22)',
  shadow: '0 28px 48px -30px rgba(251, 146, 60, 0.55)'
};

function resolveNodeTokens(
  hasStalePartitions: boolean,
  hasOutdatedUpstreams: boolean,
  darkMode: boolean
): NodeVisualTokens {
  if (hasStalePartitions) {
    return darkMode ? DARK_NODE_STALE : LIGHT_NODE_STALE;
  }
  if (hasOutdatedUpstreams) {
    return darkMode ? DARK_NODE_OUTDATED : LIGHT_NODE_OUTDATED;
  }
  return darkMode ? DARK_NODE_BASE : LIGHT_NODE_BASE;
}

function buildGraphKey(data: AssetGraphData | null, darkMode: boolean): string {
  if (!data) {
    return `empty-${darkMode ? 'dark' : 'light'}`;
  }
  const assetKey = data.assets
    .map((asset) => asset.normalizedAssetId)
    .sort()
    .join('|');
  const edgeKey = data.edges
    .map(
      (edge) => `${edge.fromAssetNormalizedId}->${edge.toAssetNormalizedId}@${edge.workflowId}:${edge.stepId}`
    )
    .sort()
    .join('|');
  return `${darkMode ? 'dark' : 'light'}:${assetKey}::${edgeKey}`;
}

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', align: 'UL', ranksep: 160, nodesep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const positionedNodes = nodes.map((node) => {
    const metadata = dagreGraph.node(node.id);
    if (!metadata) {
      return node;
    }
    return {
      ...node,
      position: {
        x: metadata.x - NODE_WIDTH / 2,
        y: metadata.y - NODE_HEIGHT / 2
      }
    };
  });

  return { nodes: positionedNodes, edges };
}

export function AssetGraphView({ data, selectedAssetId, onSelectAsset }: AssetGraphViewProps) {
  const isDarkMode = useIsDarkMode();
  const { nodes, edges } = useMemo(() => {
    if (!data) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

    const edgeStroke = isDarkMode ? 'rgba(148, 163, 184, 0.65)' : 'rgba(71, 85, 105, 0.8)';
    const edgeLabelBgStyle = isDarkMode
      ? { fill: 'rgba(15, 23, 42, 0.92)', stroke: 'rgba(51, 65, 85, 0.85)' }
      : { fill: '#f8fafc', stroke: '#e2e8f0' };
    const edgeLabelStyle = {
      color: isDarkMode ? '#e2e8f0' : '#334155'
    };

    const coreNodes: Node[] = data.assets.map((asset) => {
      const badges: JSX.Element[] = [];
      if (asset.hasOutdatedUpstreams) {
        badges.push(
          <span
            key="needs-refresh"
            className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-500/10 dark:text-sky-200"
          >
            Needs refresh
          </span>
        );
      }
      if (asset.hasStalePartitions) {
        badges.push(
          <span
            key="stale"
            className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"
          >
            Stale partitions
          </span>
        );
      }

      const tokens = resolveNodeTokens(asset.hasStalePartitions, asset.hasOutdatedUpstreams, isDarkMode);

      return {
        id: asset.normalizedAssetId,
        data: {
          label: (
            <div className="flex h-full flex-col justify-between text-left">
              <div>
                <div className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-100">
                  {asset.assetId}
                </div>
                <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">
                  {asset.normalizedAssetId}
                </div>
              </div>
              {badges.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {badges}
                </div>
              ) : null}
            </div>
          )
        },
        position: { x: 0, y: 0 },
        selectable: true,
        style: {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          borderRadius: 18,
          border: tokens.border,
          background: tokens.background,
          boxShadow: tokens.shadow,
          padding: 12,
          transition: 'border 120ms ease, box-shadow 120ms ease'
        }
      } satisfies Node;
    });

    const coreEdges: Edge[] = data.edges.map((edge) => ({
      id: `${edge.fromAssetNormalizedId}->${edge.toAssetNormalizedId}@${edge.workflowId}:${edge.stepId}`,
      source: edge.fromAssetNormalizedId,
      target: edge.toAssetNormalizedId,
      label: `${edge.workflowSlug} · ${edge.stepName}`,
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 6,
      labelBgStyle: edgeLabelBgStyle,
      labelStyle: edgeLabelStyle,
      style: { strokeWidth: 1.5, stroke: edgeStroke },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: edgeStroke
      }
    }));

    return layoutGraph(coreNodes, coreEdges);
  }, [data, isDarkMode]);

  const graphKey = useMemo(() => buildGraphKey(data, isDarkMode), [data, isDarkMode]);

  if (!data) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-3xl border border-slate-200/70 bg-white/80 text-sm text-slate-500 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-300">
        Asset graph will appear once assets are declared.
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded-3xl border border-slate-200/70 bg-white/80 text-sm text-slate-500 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-300">
        No asset dependencies found yet.
      </div>
    );
  }

  const mappedNodes = nodes.map((node) => {
    const isSelected = selectedAssetId === node.id;
    const baseStyle = { ...(node.style ?? {}) };
    if (isSelected) {
      Object.assign(baseStyle, {
        border: isDarkMode ? '2px solid rgba(129, 140, 248, 0.85)' : '2px solid #4f46e5',
        boxShadow: isDarkMode
          ? '0 30px 48px -30px rgba(129, 140, 248, 0.6)'
          : '0 22px 40px -24px rgba(79, 70, 229, 0.45)'
      });
    }
    return {
      ...node,
      style: baseStyle
    };
  });

  return (
    <div className="h-[520px] rounded-3xl border border-slate-200/70 bg-white/90 shadow-inner dark:border-slate-700/70 dark:bg-slate-900/40">
      <ReactFlow
        key={graphKey}
        nodes={mappedNodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.28 }}
        nodesDraggable={false}
        nodesFocusable={false}
        panOnDrag
        selectionOnDrag
        onNodeClick={(_, node) => onSelectAsset(node.id)}
        proOptions={{ hideAttribution: true }}
        minZoom={0.25}
        maxZoom={1.6}
      >
        <Background gap={24} color={isDarkMode ? '#1e293b' : '#dbeafe'} size={1} />
        <Controls
          showInteractive={false}
          position="top-right"
          className="rounded-xl border border-slate-200/60 bg-white/80 text-slate-500 shadow-[0_18px_32px_-24px_rgba(15,23,42,0.55)] backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300"
        />
      </ReactFlow>
    </div>
  );
}
