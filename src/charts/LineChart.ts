import { axisBottom, axisLeft, extent, format, line, scaleLinear, select } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { DataPoint, MetricDefinition } from '../data/types';
import type { YearRange } from '../state/AppState';

const MARGIN = { top: 12, right: 24, bottom: 28, left: 64 };
const HEIGHT = 200;
const YEAR_FORMAT = format('d');

type LinearScale = ScaleLinear<number, number>;
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;

/** Renders one country's time-series as a standalone, self-scaled line chart. */
export class LineChart {
  private readonly country: string;
  private readonly metric: MetricDefinition;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;

  constructor(parent: HTMLElement, country: string, metric: MetricDefinition) {
    this.country = country;
    this.metric = metric;
    this.root = select(parent).append('div').attr('class', 'line-chart');
    this.root
      .append('h3')
      .attr('class', 'line-chart__title')
      .text(this.country);
    this.svg = this.root.append('svg').attr('class', 'line-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  }

  /** Re-render for the current data and shared year domain. */
  update(points: DataPoint[], yearRange: YearRange): void {
    const width = this.root.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const x = scaleLinear().domain(yearRange).range([0, innerW]);
    const y = scaleLinear()
      .domain(this.valueDomain(points))
      .nice()
      .range([innerH, 0]);

    this.renderAxes(x, y, innerH);
    this.renderLine(points, x, y);
    this.renderDots(points, x, y);
    this.renderEmptyNotice(points, innerW, innerH);
  }

  /** Root element, used by the stack to enforce display order. */
  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.root.remove();
  }

  private valueDomain(points: DataPoint[]): [number, number] {
    const [min, max] = extent(points, (p) => p.value);
    if (min === undefined || max === undefined) return [0, 1];
    return min === max ? [0, max || 1] : [Math.min(0, min), max];
  }

  private renderAxes(x: LinearScale, y: LinearScale, innerH: number): void {
    this.group('x-axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(x).ticks(8).tickFormat((d) => YEAR_FORMAT(Number(d))));
    this.group('y-axis').call(axisLeft(y).ticks(5));
  }

  private renderLine(points: DataPoint[], x: LinearScale, y: LinearScale): void {
    const path = line<DataPoint>()
      .x((p) => x(p.year))
      .y((p) => y(p.value));
    this.group('series')
      .selectAll<SVGPathElement, DataPoint[]>('path')
      .data(points.length ? [points] : [])
      .join('path')
      .attr('class', 'line-chart__line')
      .attr('d', (d) => path(d));
  }

  private renderDots(points: DataPoint[], x: LinearScale, y: LinearScale): void {
    const dots = this.group('dots')
      .selectAll<SVGCircleElement, DataPoint>('circle')
      .data(points, (d) => (d as DataPoint).year)
      .join('circle')
      .attr('class', (d) =>
        d.isMissing ? 'line-chart__dot line-chart__dot--missing' : 'line-chart__dot',
      )
      .attr('cx', (d) => x(d.year))
      .attr('cy', (d) => y(d.value))
      .attr('r', 2.5);

    dots
      .selectAll<SVGTitleElement, DataPoint>('title')
      .data((d) => [d])
      .join('title')
      .text((d) => this.tooltip(d));

    this.renderMissingLabels(points, x, y);
  }

  /** Year numbers under interpolated points, so gaps are visibly flagged. */
  private renderMissingLabels(
    points: DataPoint[],
    x: LinearScale,
    y: LinearScale,
  ): void {
    this.group('missing-labels')
      .selectAll<SVGTextElement, DataPoint>('text')
      .data(points.filter((p) => p.isMissing), (d) => (d as DataPoint).year)
      .join('text')
      .attr('class', 'line-chart__missing-label')
      .attr('x', (d) => x(d.year))
      .attr('y', (d) => y(d.value) - 8)
      .attr('text-anchor', 'middle')
      .text((d) => YEAR_FORMAT(d.year));
  }

  private renderEmptyNotice(
    points: DataPoint[],
    innerW: number,
    innerH: number,
  ): void {
    this.group('empty')
      .selectAll<SVGTextElement, number>('text')
      .data(points.length ? [] : [0])
      .join('text')
      .attr('class', 'line-chart__empty')
      .attr('x', innerW / 2)
      .attr('y', innerH / 2)
      .attr('text-anchor', 'middle')
      .text('No data in range');
  }

  private tooltip(point: DataPoint): string {
    const value = point.value.toLocaleString();
    const note = point.isMissing ? ' (interpolated)' : '';
    return `${point.year}: ${value} ${this.metric.unit}${note}`;
  }

  /** Idempotently fetch (or create) a named plot layer group. */
  private group(name: string) {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
