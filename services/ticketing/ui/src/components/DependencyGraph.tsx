import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { FC } from 'react';
import { useMemo, useRef } from 'react';

interface GraphProps {
  nodes: Array<{ id: string; title: string; status: string }>;
  links: Array<{ source: string; target: string }>;
  onSelect: (id: string) => void;
}

export const DependencyGraph: FC<GraphProps> = ({ nodes, links, onSelect }) => {
  const graphRef = useRef<ForceGraphMethods>();

  const data = useMemo(() => ({ nodes, links }), [nodes, links]);

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderRadius: '16px',
        border: '1px solid rgba(255,255,255,0.04)',
        padding: '12px',
        height: '360px'
      }}
    >
      <ForceGraph2D
        ref={graphRef as any}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel={(node) => (node as { title?: string }).title || (node as { id: string }).id}
        nodeAutoColorBy="status"
        onNodeClick={(node) => onSelect((node as { id: string }).id)}
        linkColor={() => 'rgba(255,255,255,0.45)'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const label = (node as { title?: string; id: string }).title || (node as { id: string }).id;
          const fontSize = 12 / globalScale;
          ctx.fillStyle = '#90CAF9';
          ctx.font = `${fontSize}px Inter`;
          ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + 4);
        }}
        enableNodeDrag={false}
        cooldownTicks={50}
      />
    </div>
  );
};
