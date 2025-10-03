import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import classNames from 'classnames';
import { useD3 } from '../hooks';
import type { QueueStats } from '../types';

const STATE_ORDER = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'] as const;
const STATE_COLORS: Record<string, string> = {
  waiting: 'var(--color-status-warning-soft)',
  active: 'var(--color-status-info-soft)',
  completed: 'var(--color-status-success-soft)',
  failed: 'var(--color-status-danger-soft)',
  delayed: 'var(--color-status-warning-muted, rgba(250,204,21,0.25))',
  paused: 'var(--color-border-subtle)'
};

const WIDTH = 320;
const HEIGHT = 28;

export function QueueStateBar({ stats }: { stats: QueueStats }) {
  const segments = useMemo(() => {
    const counts = stats.counts ?? {};
    return STATE_ORDER.map((state) => ({
      state,
      value: counts[state] ?? 0
    }));
  }, [stats.counts]);

  const total = useMemo(() => segments.reduce((sum, item) => sum + item.value, 0), [segments]);

  const svgRef = useD3<SVGSVGElement>(
    (selection) => {
      selection.attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`).attr('preserveAspectRatio', 'none');
      const scale = scaleLinear().domain([0, total > 0 ? total : 1]).range([0, WIDTH]);

      let offset = 0;
      const rects = selection.selectAll<SVGRectElement, typeof segments[0]>('rect.segment').data(segments);
      rects
        .join('rect')
        .attr('class', 'segment')
        .attr('height', HEIGHT)
        .attr('y', 0)
        .attr('fill', (d) => STATE_COLORS[d.state] ?? 'var(--color-surface-muted)')
        .attr('stroke', 'var(--color-border-subtle)')
        .attr('stroke-width', 0.5)
        .attr('x', () => {
          const current = offset;
          return current;
        })
        .attr('width', (d) => {
          const width = total > 0 ? Math.max(scale(d.value), 0) : WIDTH / segments.length;
          offset += width;
          return width;
        });
    },
    [segments, total]
  );

  return <svg ref={svgRef} className="h-7 w-full" role="presentation" />;
}

export function QueueStateLegend({ stats }: { stats: QueueStats }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-3 text-scale-xs text-muted">
      {STATE_ORDER.map((state) => {
        const value = stats.counts?.[state] ?? 0;
        if (value <= 0) {
          return null;
        }
        return (
          <li key={state} className="flex items-center gap-2">
            <span
              className={classNames('h-2.5 w-2.5 rounded-full')}
              style={{ backgroundColor: STATE_COLORS[state] ?? 'var(--color-border-subtle)' }}
            />
            <span className="uppercase tracking-wide">{state}</span>
            <span>{value}</span>
          </li>
        );
      })}
    </ul>
  );
}
