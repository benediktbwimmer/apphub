import { useMemo } from 'react';
import ReactFlow, { Background, Controls, type Edge, type Node } from 'reactflow';
import dagre from 'dagre';
import type { AssetGraphData } from '../types';
import 'reactflow/dist/style.css';

type AssetGraphViewProps = {
  data: AssetGraphData | null;
  selectedAssetId: string | null;
  onSelectAsset: (normalizedAssetId: string) => void;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

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
  const { nodes, edges } = useMemo(() => {
    if (!data) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }

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

      const border = asset.hasStalePartitions
        ? '2px solid #f97316'
        : asset.hasOutdatedUpstreams
          ? '2px solid #0ea5e9'
          : '1px solid rgba(148, 163, 184, 0.6)';
      const background = asset.hasStalePartitions
        ? 'rgba(254, 215, 170, 0.3)'
        : asset.hasOutdatedUpstreams
          ? 'rgba(224, 242, 254, 0.6)'
          : '#ffffff';

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
          border,
          background,
          boxShadow: '0 18px 32px -24px rgba(15, 23, 42, 0.45)',
          padding: 12
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
      labelBgStyle: { fill: '#f8fafc', stroke: '#e2e8f0' },
      style: { strokeWidth: 1.5 }
    }));

    return layoutGraph(coreNodes, coreEdges);
  }, [data]);

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
        border: '2px solid #4f46e5',
        boxShadow: '0 22px 40px -24px rgba(79, 70, 229, 0.45)'
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
        nodes={mappedNodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesFocusable={false}
        panOnDrag
        selectionOnDrag
        onNodeClick={(_, node) => onSelectAsset(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} color="#dbeafe" size={1} />
        <Controls showInteractive={false} position="top-right" />
      </ReactFlow>
    </div>
  );
}
