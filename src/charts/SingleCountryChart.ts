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
import { resolveSeries } from '../utils/interpolation';
import type { LineDragCallbacks } from './drag-types';
import { SlopeChart } from './SlopeChart';
import type { LensWindow } from './slope-types';

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
  // Drag overlay is bound once at construction; updated path d on each render.
  private overlayPath: Selection<SVGPathElement, SeriesEntry, SVGGElement, unknown> | null = null;
  private dragBound = false;
  // Stub lens state — local to this row; replaced by real CountryLensState in Phase 4.
  private lenses: LensWindow[] = [];
  private lensActive = false;
  // Last yearRange received from update(); used to rebuild fixture on toggle
  private currentYearRange: [number, number] = [1990, 2022];

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

    // Root row wrapper — ChartArea's elementFromPoint walks up to .chart-area__row
    this.root = select(parent)
      .append('div')
      .attr('class', 'single-country-chart chart-area__row')
      .attr('data-country', country);

    // Country label above the body — textContent only (XSS-safe per T-02-01)
    const label = this.root.append('div').attr('class', 'single-country-chart__label');
    label.node()!.textContent = country;

    // Stub-lens toggle — per-row control; Phase 4 replaces this with real lens drag
    const toggle = this.root.append('button').attr('class', 'single-country-chart__lens-toggle');
    toggle.node()!.textContent = 'Lens';
    toggle.on('click', () => this.handleLensToggle());

    // Split body: line cell (existing svg) + slope cell (SlopeChart)
    const body = this.root.append('div').attr('class', 'single-country-chart__body');
    this.lineCell = body.append('div').attr('class', 'single-country-chart__line');
    const slopeCell = body.append('div').attr('class', 'single-country-chart__slope');

    // Move svg into the line cell
    this.svg = this.lineCell.append('svg').attr('class', 'single-country-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    // Mount SlopeChart in the slope cell; it appends its own div+svg
    this.slopeChart = new SlopeChart(slopeCell.node()!, dataset);
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.slopeChart.destroy();
    this.root.remove();
  }

  update(yearRange: [number, number]): void {
    this.currentYearRange = yearRange;
    // Size line chart to its cell (2/3 when lens active, 100% otherwise)
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

    this.renderAxes(x, y, innerH);
    this.renderLine(entries, x, y, innerW, innerH);
    this.renderDragOverlay(entries, x, y);

    // Re-render slope only when active; recompute fixture from current yearRange
    if (this.lensActive) {
      this.lenses = buildFixtureLenses(yearRange);
      this.slopeChart.render(this.country, this.lenses);
    }
  }

  private handleLensToggle(): void {
    this.lensActive = !this.lensActive;
    if (this.lensActive) {
      this.lenses = buildFixtureLenses(this.currentYearRange);
      this.root.classed('single-country-chart--lens-active', true);
      this.slopeChart.render(this.country, this.lenses);
    } else {
      this.lenses = [];
      this.root.classed('single-country-chart--lens-active', false);
      this.slopeChart.clear();
    }
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

  // Bind drag once (T-02-02); update only the path d on subsequent renders.
  private renderDragOverlay(entries: SeriesEntry[], x: LinearScale, y: LinearScale): void {
    const generator = line<DataPoint>()
      .x((p) => x(p.year))
      .y((p) => y(p.value));

    const overlayGroup = this.group('drag-overlays');

    if (!this.dragBound) {
      // Create the overlay path and bind drag exactly once.
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

    // Always update the path shape to match the current year range / scale.
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

/**
 * Builds two consecutive LensWindows that share a midpoint boundary (SLOPE-05).
 * The mid year is clamped to integer values inside the yearRange.
 */
function buildFixtureLenses([rangeStart, rangeEnd]: [number, number]): LensWindow[] {
  const mid = Math.round((rangeStart + rangeEnd) / 2);
  return [
    { startYear: rangeStart, endYear: mid },
    { startYear: mid, endYear: rangeEnd },
  ];
}
