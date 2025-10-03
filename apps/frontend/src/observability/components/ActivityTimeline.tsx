import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3Line, curveMonotoneX } from 'd3-shape';
import { axisBottom, axisLeft } from 'd3-axis';
import { select } from 'd3-selection';
import classNames from 'classnames';
import { useD3 } from '../hooks';
import type { CoreRunMetrics } from '../types';

const WIDTH = 680;
const HEIGHT = 240;
const MARGIN = { top: 20, right: 12, bottom: 28, left: 48 };

export function ActivityTimeline({ history }: { history: CoreRunMetrics[] }) {
  const points = useMemo(() => {
    if (history.length === 0) {
      return [];
    }
    return history.map((entry, index) => ({
      index,
      jobs: entry.jobs.total,
      workflows: entry.workflows.total,
      timestamp: entry.generatedAt
    }));
  }, [history]);

  const svgRef = useD3<SVGSVGElement>(
    (svg) => {
      svg.attr('viewBox', `0 0 ${WIDTH} ${HEIGHT}`).attr('preserveAspectRatio', 'none');
      const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
      const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

      const content = svg
        .selectAll('g.content')
        .data([null])
        .join('g')
        .attr('class', 'content')
        .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

      if (points.length === 0) {
        content.selectAll('*').remove();
        return;
      }

      const xScale = scaleLinear()
        .domain([0, Math.max(points.length - 1, 1)])
        .range([0, plotWidth]);

      const maxValue = Math.max(...points.map((point) => Math.max(point.jobs, point.workflows)), 1);
      const yScale = scaleLinear()
        .domain([0, maxValue])
        .range([plotHeight, 0])
        .nice();

      const lineJobs = d3Line<typeof points[0]>()
        .x((point) => xScale(point.index))
        .y((point) => yScale(point.jobs))
        .curve(curveMonotoneX);

      const lineWorkflows = d3Line<typeof points[0]>()
        .x((point) => xScale(point.index))
        .y((point) => yScale(point.workflows))
        .curve(curveMonotoneX);

      content
        .selectAll('path.timeline-jobs')
        .data([points])
        .join('path')
        .attr('class', 'timeline-jobs')
        .attr('fill', 'none')
        .attr('stroke', 'var(--color-accent-default)')
        .attr('stroke-width', 2)
        .attr('d', (values) => lineJobs(values) ?? '');

      content
        .selectAll('path.timeline-workflows')
        .data([points])
        .join('path')
        .attr('class', 'timeline-workflows')
        .attr('fill', 'none')
        .attr('stroke', 'var(--color-status-info)')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,4')
        .attr('d', (values) => lineWorkflows(values) ?? '');

      const xAxis = axisBottom(xScale)
        .ticks(Math.min(points.length, 6))
        .tickFormat((value) => {
          const point = points[Math.round(Number(value))];
          if (!point) {
            return '';
          }
          const date = new Date(point.timestamp);
          return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        });

      const yAxis = axisLeft(yScale).ticks(5).tickFormat((value) => String(Math.round(Number(value))));

      const xAxisGroup = content
        .selectAll<SVGGElement, null>('g.x-axis')
        .data([null])
        .join('g')
        .attr('class', 'x-axis text-scale-xxs text-muted')
        .attr('transform', `translate(0, ${plotHeight})`);

      xAxisGroup.each(function callXAxis() {
        select(this).call(xAxis);
      });

      const yAxisGroup = content
        .selectAll<SVGGElement, null>('g.y-axis')
        .data([null])
        .join('g')
        .attr('class', 'y-axis text-scale-xxs text-muted');

      yAxisGroup.each(function callYAxis() {
        select(this).call(yAxis);
      });
    },
    [points]
  );

  return (
    <div className="rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-scale-base font-weight-semibold text-primary">System activity timeline</h2>
          <div className="flex items-center gap-3 text-scale-xxs text-muted">
            <LegendSwatch color="var(--color-accent-default)" label="Jobs" />
            <LegendSwatch color="var(--color-status-info)" label="Workflows" dashed />
          </div>
        </div>
        <span className="text-scale-xs text-muted">
          Historical samples computed from core metrics. Lines update every polling tick.
        </span>
      </div>
      <svg ref={svgRef} className="mt-4 h-60 w-full" role="presentation" />
    </div>
  );
}

function LegendSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={classNames('inline-block h-2 w-6 rounded-full', dashed ? 'border' : '')}
        style={
          dashed
            ? { borderColor: color, borderWidth: 2, borderStyle: 'dashed' }
            : { backgroundColor: color }
        }
      />
      <span>{label}</span>
    </span>
  );
}
