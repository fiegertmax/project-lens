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
import type { CountryLensState, PlacedLens } from '../state/CountryLensState';
import { LENS_STAGE_WIDTH, STAGE_COLORS } from '../config';
import { resolveSeries } from '../utils/interpolation';
import type { LineDragCallbacks } from './drag-types';
import type { LensSync } from './LensSync';
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

  private lensState: CountryLensState | null = null;
  private lensSync: LensSync | null = null;
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

  /**
   * Wires this chart to CountryLensState + LensSync. Subscribes to state changes
   * and re-renders the lens bands and slope chart when lenses change.
   * Replaces the old setLens(LensState) path (removed per Plan 04-04).
   */
  setLensState(state: CountryLensState, sync: LensSync): void {
    this.lensUnsub?.();
    this.lensState = state;
    this.lensSync = sync;
    this.lensUnsub = state.subscribe(() => this.renderLenses());
    this.renderLenses();
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

    // Lens bands first so the line and axes render on top of them
    this.renderPlacedLensBands(x, yearRange, innerW, innerH);
    this.renderAxes(x, y, innerH);
    this.renderLine(entries, x, y, innerW, innerH);
    this.renderDragOverlay(entries, x, y);
  }

  /**
   * Responds to CountryLensState changes: toggles --lens-active class, triggers
   * line-cell resize, and schedules a slope re-render after layout reflow.
   */
  private renderLenses(): void {
    if (!this.lensState) return;
    const lenses = this.lensState.lensesFor(this.country);
    const active = lenses.length > 0;
    this.root.classed('single-country-chart--lens-active', active);
    // Re-render the line chart so the SVG resizes to the new line-cell width
    this.update(this.currentYearRange);
    if (active) {
      // Defer slope render one frame so display:block has reflowed before measuring width
      requestAnimationFrame(() => this.renderSlope(lenses));
    } else {
      this.slopeChart.clear();
    }
  }

  private renderSlope(lenses: PlacedLens[]): void {
    this.slopeChart.render(
      this.country,
      lenses.map((l) => ({ stage: l.stage, startYear: l.startYear, endYear: l.endYear })),
    );
  }

  /**
   * Draws one rect.placed-lens__rect per PlacedLens, stage-colored (LENS-02).
   * Attaches x-drag via moveLinkedLens (LENSUI-01 + LENSUI-04) and
   * Ctrl/Cmd+wheel resize via resizeLinkedLens (LENSUI-02).
   */
  private renderPlacedLensBands(
    x: LinearScale,
    yearRange: [number, number],
    innerW: number,
    innerH: number,
  ): void {
    const bandGroup = this.group('lens-band');

    const lenses = this.lensState?.lensesFor(this.country) ?? [];
    if (lenses.length === 0) {
      bandGroup.selectAll('*').remove();
      return;
    }

    const yearsPerPixel = (yearRange[1] - yearRange[0]) / innerW;

    // One rect per placed lens, keyed by id
    bandGroup
      .selectAll<SVGRectElement, PlacedLens>('rect.placed-lens__rect')
      .data(lenses, (d) => d.id)
      .join('rect')
      .attr('class', 'placed-lens__rect')
      .attr('x', (d) => x(Math.max(yearRange[0], d.startYear)))
      .attr('y', 0)
      .attr('width', (d) => {
        const bx = x(Math.max(yearRange[0], d.startYear));
        const ex = x(Math.min(yearRange[1], d.endYear));
        return Math.max(0, ex - bx);
      })
      .attr('height', innerH)
      .attr('fill', (d) => STAGE_COLORS[d.stage])
      .attr('fill-opacity', 0.18)
      .attr('stroke', (d) => STAGE_COLORS[d.stage])
      .attr('stroke-width', 1.5)
      .attr('cursor', 'ew-resize')
      .call(this.makeLensDrag(yearsPerPixel))
      .on('wheel.lens', (ev: WheelEvent, d) => this.handleLensWheel(ev, d));

    // Year labels at band edges
    const labelData = lenses.flatMap((d) => [
      { x: x(Math.max(yearRange[0], d.startYear)), year: d.startYear, anchor: 'start' as const },
      { x: x(Math.min(yearRange[1], d.endYear)), year: d.endYear, anchor: 'end' as const },
    ]);

    bandGroup
      .selectAll<SVGTextElement, (typeof labelData)[number]>('text.placed-lens__label')
      .data(labelData, (d) => `${d.year}-${d.anchor}`)
      .join('text')
      .attr('class', 'placed-lens__label')
      .attr('x', (d) => d.x)
      .attr('y', -3)
      .attr('text-anchor', (d) => d.anchor)
      .text((d) => String(d.year));
  }

  /**
   * Returns a d3 drag behaviour that moves the dragged lens via LensSync.
   * Live position update happens on 'drag'; slope re-renders on 'end' only (ROADMAP).
   */
  private makeLensDrag(yearsPerPixel: number) {
    return drag<SVGRectElement, PlacedLens>()
      .on('drag', (ev: D3DragEvent<SVGRectElement, PlacedLens, unknown>, d) => {
        if (!this.lensSync) return;
        const delta = ev.dx * yearsPerPixel;
        this.lensSync.moveLinkedLens(this.country, d.id, delta);
        // Update band position live for immediate visual feedback
        const updatedLenses = this.lensState?.lensesFor(this.country) ?? [];
        const updated = updatedLenses.find((l) => l.id === d.id);
        if (updated) {
          const rect = select(ev.sourceEvent.target as SVGRectElement);
          const yr = this.currentYearRange;
          const w = this.lineCell.node()!.clientWidth || 600;
          const iW = w - MARGIN.left - MARGIN.right;
          const xScale = scaleLinear().domain(yr).range([0, iW]);
          rect
            .attr('x', xScale(Math.max(yr[0], updated.startYear)))
            .attr('width', Math.max(0, xScale(Math.min(yr[1], updated.endYear)) - xScale(Math.max(yr[0], updated.startYear))));
        }
      })
      .on('end', () => {
        // Re-render slope after drag ends (ROADMAP: slope update on drag-end only)
        const currentLenses = this.lensState?.lensesFor(this.country) ?? [];
        if (currentLenses.length > 0) {
          requestAnimationFrame(() => this.renderSlope(currentLenses));
        }
        // Full band re-render to sync labels and any linked lens positions
        this.update(this.currentYearRange);
      });
  }

  /**
   * Handles Ctrl/Cmd+wheel over a lens band: resizes the lens via LensSync (LENSUI-02).
   * Normal scroll is untouched (T-04-06 threat mitigated).
   */
  private handleLensWheel(ev: WheelEvent, lens: PlacedLens): void {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    if (!this.lensSync) return;

    const currentSpan = lens.endYear - lens.startYear;
    // deltaY > 0 = scroll down = shrink; < 0 = scroll up = grow
    const step = ev.deltaY > 0 ? -1 : 1;
    const newSpan = Math.min(
      LENS_STAGE_WIDTH.max,
      Math.max(LENS_STAGE_WIDTH.min, currentSpan + step),
    );
    this.lensSync.resizeLinkedLens(this.country, lens.id, newSpan);
    // Re-render bands and slope after resize
    this.update(this.currentYearRange);
    const updatedLenses = this.lensState?.lensesFor(this.country) ?? [];
    if (updatedLenses.length > 0) {
      requestAnimationFrame(() => this.renderSlope(updatedLenses));
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
