import { useMemo } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3Line, curveMonotoneX } from 'd3-shape';
import { extent } from 'd3-array';
import classNames from 'classnames';
import { useD3 } from '../hooks';

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string | null;
  className?: string;
};

const DEFAULT_WIDTH = 140;
const DEFAULT_HEIGHT = 40;

export function Sparkline({
  data,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  stroke = 'var(--color-accent-default)',
  fill = null,
  className
}: SparklineProps) {
  const points = useMemo(() => data.map((value, index) => ({ value, index })), [data]);

  const svgRef = useD3<SVGSVGElement>(
    (selection) => {
      selection.attr('viewBox', `0 0 ${width} ${height}`).attr('preserveAspectRatio', 'none');

      const cleanData = points.length > 0 ? points : [{ value: 0, index: 0 }];
      const xScale = scaleLinear()
        .domain([0, Math.max(cleanData.length - 1, 1)])
        .range([0, width]);

      const [min, max] = extent(cleanData, (point) => point.value) as [number, number];
      const yDomain = min === undefined || max === undefined || min === max ? [min ?? 0, (max ?? 0) + 1] : [min, max];
      const yScale = scaleLinear().domain(yDomain).range([height - 4, 4]);

      const lineGenerator = d3Line<{ value: number; index: number }>()
        .x((point) => xScale(point.index))
        .y((point) => yScale(point.value))
        .curve(curveMonotoneX);

      const areaGenerator = d3Line<{ value: number; index: number }>()
        .x((point) => xScale(point.index))
        .y((point) => yScale(point.value))
        .curve(curveMonotoneX);

      const areaSelection = selection.selectAll<SVGPathElement, typeof cleanData>('path.sparkline-area').data(fill ? [cleanData] : []);
      areaSelection
        .join(
          (enter) =>
            enter
              .append('path')
              .attr('class', 'sparkline-area')
              .attr('fill', fill ?? 'none')
              .attr('stroke', 'none'),
          (update) => update,
          (exit) => exit.remove()
        )
        .attr('d', (values) => areaGenerator(values) ?? '');

      const pathSelection = selection.selectAll<SVGPathElement, typeof cleanData>('path.sparkline-line').data([cleanData]);
      pathSelection
        .join('path')
        .attr('class', 'sparkline-line')
        .attr('fill', 'none')
        .attr('stroke-width', 1.8)
        .attr('stroke', stroke)
        .attr('stroke-linecap', 'round')
        .attr('d', (values) => lineGenerator(values) ?? '');
    },
    [points, width, height, stroke, fill]
  );

  return <svg ref={svgRef} role="presentation" className={classNames('h-16 w-full', className)} />;
}
