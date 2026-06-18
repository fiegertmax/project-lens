import {
  axisBottom,
  axisLeft,
  drag,
  format,
  line,
  scaleLinear,
  select,
} from 'd3';
import type { D3DragEvent, ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { DataPoint, MetricDefinition } from '../data/types';
import type { LensState } from '../state/LensState';
import { resolveSeries } from '../utils/interpolation';
import type { LineDragCallbacks } from './drag-types';
import { SlopeChart } from './SlopeChart';

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

/** Renders a single extracted country as a labeled row with a fitted y-axis and drag overlay. */
export class SingleCountryChart {
  private readonly country: string;
  private readonly dataset: EmissionsDataset;
  private readonly metric: MetricDefinition;
  private readonly colorFor: (c: string) => string;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly lineCell: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;
  private readonly slopeChart: SlopeChart;
  private overlayPath: Selection<SVGPathElement, SeriesEntry, SVGGElement, unknown> | null = null;
  private dragBound = false;

  private lens: LensState | null = null;
  private lensUnsub: (() => void) | null = null;
  // Last year range from update(); needed to re-render after lens state changes
  private currentYearRange: [number, number] = [1950, 2022];

  /** Settable by ChartArea after construction; fires on overlay drag events. */
  callbacks?: LineDragCallbacks;

  constructor(
    parent: HTMLElement,
    country: string,
    dataset: EmissionsDataset,
    metric: MetricDefinition,
    colorFor: (c: string) => string,
  ) {
    this.country = country;
    this.dataset = dataset;
    this.metric = metric;
    this.colorFor = colorFor;

    this.root = select(parent)
      .append('div')
      .attr('class', 'single-country-chart chart-area__row')
      .attr('data-country', country);

    const label = this.root.append('div').attr('class', 'single-country-chart__label');
    label.node()!.textContent = country;

    const body = this.root.append('div').attr('class', 'single-country-chart__body');
    this.lineCell = body.append('div').attr('class', 'single-country-chart__line');
    const slopeCell = body.append('div').attr('class', 'single-country-chart__slope');

    this.svg = this.lineCell.append('svg').attr('class', 'single-country-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    this.slopeChart = new SlopeChart(slopeCell.node()!, dataset);
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.lensUnsub?.();
    this.slopeChart.destroy();
    this.root.remove();
  }

  /** Wire this chart to a shared LensState; subscribes and syncs immediately. */
  setLens(lens: LensState): void {
    this.lensUnsub?.();
    this.lens = lens;
    this.lensUnsub = lens.subscribe(() => this.syncLens());
    this.syncLens();
  }

  update(yearRange: [number, number]): void {
    this.currentYearRange = yearRange;
    // Reading clientWidth forces reflow so the flex-shrink layout has settled
    const width = this.lineCell.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const rawSeries = this.dataset.series(this.country);
    const points = rawSeries ? resolveSeries(rawSeries, yearRange) : [];
    const entries: SeriesEntry[] = [{ country: this.country, points }];

    const x = scaleLinear().domain(yearRange).range([0, innerW]);
    const [yMin, yMax] = computeYDomain(entries);
    const y = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    // Lens band first so the line and axes render on top of it
    this.renderLensBand(x, yearRange, innerW, innerH);
    this.renderAxes(x, y, innerH);
    this.renderLine(entries, x, y, innerW, innerH);
    this.renderDragOverlay(entries, x, y);
  }

  /** Called when LensState changes: show/hide slope + re-render to resize SVG and band. */
  private syncLens(): void {
    if (!this.lens) return;
    const active = this.lens.isTarget(this.country);
    this.root.classed('single-country-chart--lens-active', active);
    // Re-render the line chart so the SVG resizes to the new line-cell width
    this.update(this.currentYearRange);
    if (active) {
      // Defer slope render one frame so display:block has reflowed before measuring width
      requestAnimationFrame(() => this.renderSlope());
    } else {
      this.slopeChart.clear();
    }
  }

  private renderSlope(): void {
    if (!this.lens) return;
    const halfWidth = this.lens.currentWidth() / 2;
    const center = this.lens.centerYear();
    // stage 1 default for legacy LensState path (replaced in Plan 04-04 Task 2)
    this.slopeChart.render(this.country, [
      { startYear: Math.round(center - halfWidth), endYear: Math.round(center + halfWidth), stage: 1 },
    ]);
  }

  /** Draws the interactive lens band (tinted rect) on the SVG when this country is lensed. */
  private renderLensBand(
    x: LinearScale,
    yearRange: [number, number],
    innerW: number,
    innerH: number,
  ): void {
    const bandGroup = this.group('lens-band');

    if (!this.lens || !this.lens.isTarget(this.country)) {
      bandGroup.selectAll('*').remove();
      return;
    }

    const halfW = this.lens.currentWidth() / 2;
    const center = this.lens.centerYear();
    const bandStart = Math.max(yearRange[0], center - halfW);
    const bandEnd = Math.min(yearRange[1], center + halfW);
    const bx = x(bandStart);
    const bw = Math.max(0, x(bandEnd) - bx);

    const lens = this.lens;

    bandGroup
      .selectAll<SVGRectElement, null>('rect.lens-band__rect')
      .data([null])
      .join('rect')
      .attr('class', 'lens-band__rect')
      .attr('x', bx)
      .attr('y', 0)
      .attr('width', bw)
      .attr('height', innerH)
      .call(
        drag<SVGRectElement, null>()
          .on('drag', (ev: D3DragEvent<SVGRectElement, null, unknown>) => {
            const yearsPerPixel = (yearRange[1] - yearRange[0]) / innerW;
            lens.setCenter(lens.centerYear() + ev.dx * yearsPerPixel);
          }),
      );

    // Year labels at band edges
    bandGroup
      .selectAll<SVGTextElement, [number, number]>('text.lens-band__label')
      .data([[bx, Math.round(center - halfW)], [bx + bw, Math.round(center + halfW)]] as [number, number][])
      .join('text')
      .attr('class', 'lens-band__label')
      .attr('x', (d) => d[0])
      .attr('y', -3)
      .attr('text-anchor', (_, i) => (i === 0 ? 'start' : 'end'))
      .text((d) => String(d[1]));
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
      .attr('class', 'single-country-chart__y-title')
      .attr('transform', `translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .attr('font-size', '11px')
      .text((d) => d);
  }

  private renderLine(
    entries: SeriesEntry[],
    x: LinearScale,
    y: LinearScale,
    innerW: number,
    innerH: number,
  ): void {
    const generator = line<DataPoint>()
      .x((p) => x(p.year))
      .y((p) => y(p.value));

    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.single-line')
      .data(entries, (d) => d.country)
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'single-line')
            .attr('fill', 'none')
            .attr('opacity', 0)
            .call((p) => p.transition().duration(200).attr('opacity', 1)),
        (update) => update,
        (exit) =>
          exit.call((p) => p.transition().duration(200).attr('opacity', 0).remove()),
      )
      .attr('stroke', () => this.colorFor(this.country))
      .attr('stroke-width', 1.5)
      .attr('d', (d) => generator(d.points) ?? '');

    this.renderEmptyNotice(entries, innerW, innerH);
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

  private renderDragOverlay(entries: SeriesEntry[], x: LinearScale, y: LinearScale): void {
    const generator = line<DataPoint>()
      .x((p) => x(p.year))
      .y((p) => y(p.value));

    const overlayGroup = this.group('drag-overlays');

    if (!this.dragBound) {
      this.overlayPath = overlayGroup
        .selectAll<SVGPathElement, SeriesEntry>('path.single-line-hit')
        .data(entries, (d) => d.country)
        .join('path')
        .attr('class', 'single-line-hit')
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 12)
        .attr('pointer-events', 'stroke');

      this.overlayPath.call(
        drag<SVGPathElement, SeriesEntry>()
          .on('start', (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) => {
            this.callbacks?.onDragStart(d.country, ev.sourceEvent.clientX, ev.sourceEvent.clientY);
          })
          .on('drag', (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) => {
            this.callbacks?.onDragMove(d.country, ev.sourceEvent.clientX, ev.sourceEvent.clientY);
          })
          .on('end', (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) => {
            this.callbacks?.onDragEnd(d.country, ev.sourceEvent.clientX, ev.sourceEvent.clientY);
          }),
      );

      this.dragBound = true;
    }

    if (this.overlayPath) {
      this.overlayPath.attr('d', (d) => generator(d.points) ?? '');
    }
  }

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
