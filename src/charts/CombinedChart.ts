import {
  axisBottom,
  axisLeft,
  format,
  line,
  scaleLinear,
  scaleOrdinal,
  schemeTableau10,
  select,
} from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { DataPoint, MetricDefinition } from '../data/types';
import type { AppState } from '../state/AppState';
import { resolveSeries } from '../utils/interpolation';

const MARGIN = { top: 12, right: 64, bottom: 28, left: 72 };
const HEIGHT = 360;
const YEAR_FORMAT = format('d');

type LinearScale = ScaleLinear<number, number>;
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;

interface SeriesEntry {
  country: string;
  points: DataPoint[];
}

function computeYDomain(entries: SeriesEntry[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const { points } of entries)
    for (const { value } of points) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  if (!Number.isFinite(min)) return [0, 1];
  return [Math.min(0, min), max || 1];
}

/** Renders all selected countries as lines in one shared SVG with a combined y-axis. */
export class CombinedChart {
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  private readonly metric: MetricDefinition;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;
  private readonly unsub: () => void;

  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    metric: MetricDefinition,
  ) {
    this.dataset = dataset;
    this.state = state;
    this.metric = metric;
    this.root = select(parent).append('div').attr('class', 'combined-chart');
    this.svg = this.root.append('svg').attr('class', 'combined-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
    this.unsub = state.subscribe(() => this.update());
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.unsub();
    this.root.remove();
  }

  update(): void {
    const width = this.root.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const yearRange = this.state.yearRange();
    const countries = this.state.selectedCountries();

    const entries: SeriesEntry[] = countries.map((country) => {
      const series = this.dataset.series(country);
      return { country, points: series ? resolveSeries(series, yearRange) : [] };
    });

    const x = scaleLinear().domain(yearRange).range([0, innerW]);
    const [yMin, yMax] = computeYDomain(entries);
    const y = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    const color = scaleOrdinal(countries, schemeTableau10 as readonly string[]);

    this.renderAxes(x, y, innerH);
    this.renderLines(entries, x, y, color, innerW, innerH);
    this.renderLegend(countries, color, innerW);
  }

  private renderAxes(x: LinearScale, y: LinearScale, innerH: number): void {
    this.group('x-axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(x).ticks(8).tickFormat((d) => YEAR_FORMAT(Number(d))));
    this.group('y-axis').call(axisLeft(y).ticks(5));
    this.group('y-title')
      .selectAll<SVGTextElement, string>('text')
      .data([`${this.metric.label} (${this.metric.unit})`])
      .join('text')
      .attr('class', 'combined-chart__y-title')
      .attr('transform', `translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '11px')
      .text((d) => d);
  }

  private renderLines(
    entries: SeriesEntry[],
    x: LinearScale,
    y: LinearScale,
    color: (c: string) => string,
    innerW: number,
    innerH: number,
  ): void {
    const generator = line<DataPoint>()
      .x((p) => x(p.year))
      .y((p) => y(p.value));

    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.combined-line')
      .data(entries, (d) => d.country)
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'combined-line')
            .attr('fill', 'none')
            .attr('opacity', 0)
            .call((p) => p.transition().duration(200).attr('opacity', 1)),
        (update) => update,
        (exit) =>
          exit.call((p) => p.transition().duration(200).attr('opacity', 0).remove()),
      )
      .attr('data-country', (d) => d.country)
      .attr('stroke', (d) => color(d.country))
      .attr('stroke-width', 1.5)
      .attr('pointer-events', 'stroke')
      .attr('d', (d) => generator(d.points) ?? '')
      .on('mouseover', (_event, d) => this.highlight(d.country))
      .on('mouseout', () => this.clearHighlight());

    this.renderEmptyNotice(entries, innerW, innerH);
  }

  private renderLegend(countries: string[], color: (c: string) => string, innerW: number): void {
    const legendGroup = this.group('legend').attr(
      'transform',
      `translate(${innerW - 160},8)`,
    );

    legendGroup
      .selectAll<SVGRectElement, unknown>('rect.legend-bg')
      .data([null])
      .join('rect')
      .attr('class', 'legend-bg')
      .attr('width', 160)
      .attr('height', countries.length * 20 + 8)
      .attr('rx', 4)
      .attr('fill', 'var(--bg)')
      .attr('stroke', 'var(--border)')
      .attr('stroke-width', 1);

    legendGroup
      .selectAll<SVGGElement, string>('g.legend-row')
      .data(countries, (d) => d)
      .join(
        (enter) => enter.append('g').attr('class', 'legend-row'),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('transform', (_d, i) => `translate(8,${i * 20 + 8})`)
      .attr('cursor', 'default')
      .call((row) => {
        row
          .selectAll<SVGRectElement, string>('rect.legend-swatch')
          .data((d) => [d])
          .join('rect')
          .attr('class', 'legend-swatch')
          .attr('width', 10)
          .attr('height', 10)
          .attr('rx', 2)
          .attr('fill', (d) => color(d));

        row
          .selectAll<SVGTextElement, string>('text.legend-label')
          .data((d) => [d])
          .join('text')
          .attr('class', 'legend-label')
          .attr('x', 16)
          .attr('y', 9)
          .attr('font-size', '12px')
          .attr('fill', 'var(--text)')
          .text((d) => d);
      })
      .on('mouseover', (_event, d) => this.highlight(d))
      .on('mouseout', () => this.clearHighlight());
  }

  private renderEmptyNotice(entries: SeriesEntry[], innerW: number, innerH: number): void {
    const hasData = entries.some((e) => e.points.length > 0);
    this.group('empty')
      .selectAll<SVGTextElement, number>('text')
      .data(hasData ? [] : [0])
      .join('text')
      .attr('x', innerW / 2)
      .attr('y', innerH / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '12px')
      .text('No data for selected range');
  }

  private highlight(country: string): void {
    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.combined-line')
      .transition()
      .duration(100)
      .attr('opacity', (d) => (d.country === country ? 1 : 0.15));

    this.group('legend')
      .selectAll<SVGGElement, string>('g.legend-row')
      .transition()
      .duration(100)
      .attr('opacity', (d) => (d === country ? 1 : 0.15));
  }

  private clearHighlight(): void {
    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.combined-line')
      .transition()
      .duration(100)
      .attr('opacity', 1);

    this.group('legend')
      .selectAll<SVGGElement, string>('g.legend-row')
      .transition()
      .duration(100)
      .attr('opacity', 1);
  }

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
