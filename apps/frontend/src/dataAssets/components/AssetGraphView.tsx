import { useMemo, type JSX } from 'react';
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow';
import dagre from 'dagre';
import type { AssetGraphData } from '../types';
import 'reactflow/dist/style.css';
import { useIsDarkMode } from '../../hooks/useIsDarkMode';
import {
  DATA_ASSET_EMPTY_STATE,
  DATA_ASSET_GRAPH_CONTAINER,
  DATA_ASSET_GRAPH_CONTROLS,
  DATA_ASSET_GRAPH_EDGE,
  DATA_ASSET_GRAPH_EDGE_LABEL_BACKGROUND,
  DATA_ASSET_GRAPH_EDGE_LABEL_BORDER,
  DATA_ASSET_GRAPH_EDGE_LABEL_TEXT,
  DATA_ASSET_GRAPH_GRID_COLOR,
  DATA_ASSET_GRAPH_NODE,
  DATA_ASSET_STATUS_BADGE_REFRESH,
  DATA_ASSET_STATUS_BADGE_STALE
} from '../dataAssetsTokens';

type AssetGraphViewProps = {
  data: AssetGraphData | null;
  selectedAssetId: string | null;
  onSelectAsset: (normalizedAssetId: string) => void;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

type NodeVisualStyle = {
  border: string;
  background: string;
  shadow: string;
};

function resolveNodeStyle(hasStalePartitions: boolean, hasOutdatedUpstreams: boolean): NodeVisualStyle {
  if (hasStalePartitions) {
    return { ...DATA_ASSET_GRAPH_NODE.base, ...DATA_ASSET_GRAPH_NODE.stale };
  }
  if (hasOutdatedUpstreams) {
    return { ...DATA_ASSET_GRAPH_NODE.base, ...DATA_ASSET_GRAPH_NODE.refresh };
  }
  return { ...DATA_ASSET_GRAPH_NODE.base };
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

    const edgeStroke = DATA_ASSET_GRAPH_EDGE;
    const edgeLabelBgStyle = {
      fill: DATA_ASSET_GRAPH_EDGE_LABEL_BACKGROUND,
      stroke: DATA_ASSET_GRAPH_EDGE_LABEL_BORDER
    };
    const edgeLabelStyle = {
      color: DATA_ASSET_GRAPH_EDGE_LABEL_TEXT
    };

    const coreNodes: Node[] = data.assets.map((asset) => {
      const badges: JSX.Element[] = [];
      if (asset.hasOutdatedUpstreams) {
        badges.push(
          <span
            key="needs-refresh"
            className={DATA_ASSET_STATUS_BADGE_REFRESH}
          >
            Needs refresh
          </span>
        );
      }
      if (asset.hasStalePartitions) {
        badges.push(
          <span
            key="stale"
            className={DATA_ASSET_STATUS_BADGE_STALE}
          >
            Stale partitions
          </span>
        );
      }

      const nodeStyle = resolveNodeStyle(asset.hasStalePartitions, asset.hasOutdatedUpstreams);

      return {
        id: asset.normalizedAssetId,
        data: {
          label: (
            <div className="flex h-full flex-col justify-between text-left">
              <div>
                <div className="text-scale-sm font-weight-semibold leading-5 text-primary">
                  {asset.assetId}
                </div>
                <div className="text-scale-2xs uppercase tracking-[0.18em] text-muted">
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
          border: nodeStyle.border,
          background: nodeStyle.background,
          boxShadow: nodeStyle.shadow,
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
  }, [data]);

  const graphKey = useMemo(() => buildGraphKey(data, isDarkMode), [data, isDarkMode]);

  if (!data) {
    return (
      <div className={DATA_ASSET_EMPTY_STATE}>
        Asset graph will appear once assets are declared.
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className={DATA_ASSET_EMPTY_STATE}>
        No asset dependencies found yet.
      </div>
    );
  }

  const mappedNodes = nodes.map((node) => {
    const isSelected = selectedAssetId === node.id;
    const baseStyle = { ...(node.style ?? {}) };
    if (isSelected) {
      Object.assign(baseStyle, DATA_ASSET_GRAPH_NODE.selected);
    }
    return {
      ...node,
      style: baseStyle
    };
  });

  return (
    <div className={DATA_ASSET_GRAPH_CONTAINER}>
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
        <Background gap={24} color={DATA_ASSET_GRAPH_GRID_COLOR} size={1} />
        <Controls
          showInteractive={false}
          position="top-right"
          className={DATA_ASSET_GRAPH_CONTROLS}
        />
      </ReactFlow>
    </div>
  );
}
