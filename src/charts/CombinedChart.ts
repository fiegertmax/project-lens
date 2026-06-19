import {
  axisBottom,
  axisLeft,
  drag,
  format,
  line,
  scaleLinear,
  scaleOrdinal,
  schemeTableau10,
  select,
} from 'd3';
import type { D3DragEvent, ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { DataPoint, MetricDefinition } from '../data/types';
import type { AppState } from '../state/AppState';
import type { CountryLensState } from '../state/CountryLensState';
import { COMBINED_CHART_KEY } from '../state/CountryLensState';
import { resolveSeries } from '../utils/interpolation';
import type { LineDragCallbacks } from './drag-types';
import type { LensSync } from './LensSync';
import { renderLensBands as renderLensBandsHelper } from './LensBandRenderer';

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

  /** Externally-supplied country list; overrides state.selectedCountries() in update(). */
  private countries: string[];

  // Lens state — mirrors SingleCountryChart lines 60-64
  private lensState: CountryLensState | null = null;
  private lensSync: LensSync | null = null;
  private lensUnsub: (() => void) | null = null;
  // Last year range from update(); needed to re-render after lens state changes
  private currentYearRange: [number, number] = [1950, 2022];

  /** Optional shared color function from ChartArea; prevents color shifts on extraction. */
  colorFor?: (c: string) => string;

  /** Drag callbacks set by ChartArea after construction. */
  callbacks?: LineDragCallbacks;

  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    metric: MetricDefinition,
  ) {
    this.dataset = dataset;
    this.state = state;
    this.metric = metric;
    // Initialize from current selection so first paint matches existing behavior
    this.countries = state.selectedCountries();
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

  /**
   * Wires this chart to CountryLensState + LensSync. Mirrors SingleCountryChart.setLensState.
   * Re-subscribing clears the prior handle per Pitfall 4: prevents a leaked subscriber
   * firing into a detached DOM.
   */
  setLensState(state: CountryLensState, sync: LensSync): void {
    this.lensUnsub?.();
    this.lensState = state;
    this.lensSync = sync;
    this.lensUnsub = state.subscribe(() => this.renderLensBands());
    this.renderLensBands();
  }

  destroy(): void {
    // Clear lens subscription first — prevents leaked subscriber firing into detached DOM (Pitfall 4)
    this.lensUnsub?.();
    this.unsub();
    this.root.remove();
  }

  /** Replace the rendered country list (e.g. after extraction) and re-render. */
  updateCountries(countries: string[]): void {
    this.countries = countries;
    this.update();
  }

  update(): void {
    const width = this.root.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const yearRange = this.state.yearRange();
    // Use externally-supplied list; ChartArea overrides via updateCountries()
    const countries = this.countries;

    const entries: SeriesEntry[] = countries.map((country) => {
      const series = this.dataset.series(country);
      return { country, points: series ? resolveSeries(series, yearRange) : [] };
    });

    const x = scaleLinear().domain(yearRange).range([0, innerW]);
    const [yMin, yMax] = computeYDomain(entries);
    const y = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    // Prefer shared colorFor to avoid color shifts when countries are extracted
    const color = this.colorFor
      ? this.colorFor
      : (c: string) => scaleOrdinal(countries, schemeTableau10 as readonly string[])(c);

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
      .data(entries.filter(Boolean), (d) => d?.country ?? '')
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

    this.renderDragOverlays(entries, generator);
    this.renderEmptyNotice(entries, innerW, innerH);
  }

  /**
   * Renders 12px transparent overlay paths for drag hit area.
   * Drag is bound in the ENTER branch only to avoid stacking listeners on re-render.
   */
  private renderDragOverlays(
    entries: SeriesEntry[],
    generator: (points: DataPoint[]) => string | null,
  ): void {
    const self = this;
    this.group('drag-overlays')
      .selectAll<SVGPathElement, SeriesEntry>('path.combined-line-hit')
      .data(entries.filter(Boolean), (d) => d?.country ?? '')
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'combined-line-hit')
            .attr('fill', 'none')
            .attr('stroke', 'transparent')
            .attr('stroke-width', 12)
            .attr('pointer-events', 'stroke')
            .attr('cursor', 'grab')
            // Bind drag once on enter only — avoids stacking listeners (anti-pattern)
            .call(
              drag<SVGPathElement, SeriesEntry>()
                .on('start', function (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) {
                  // Dim source line directly (no transition during drag — Pitfall 4)
                  self
                    .group('lines')
                    .select<SVGPathElement>(`path.combined-line[data-country="${d.country}"]`)
                    .attr('opacity', 0.2);
                  // Use sourceEvent viewport coords — never ev.x (SVG-local, Pitfall 1)
                  self.callbacks?.onDragStart(
                    d.country,
                    ev.sourceEvent.clientX,
                    ev.sourceEvent.clientY,
                  );
                })
                .on('drag', function (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) {
                  self.callbacks?.onDragMove(
                    d.country,
                    ev.sourceEvent.clientX,
                    ev.sourceEvent.clientY,
                  );
                })
                .on('end', function (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) {
                  // Restore source line opacity
                  self
                    .group('lines')
                    .select<SVGPathElement>(`path.combined-line[data-country="${d.country}"]`)
                    .attr('opacity', 1);
                  self.callbacks?.onDragEnd(
                    d.country,
                    ev.sourceEvent.clientX,
                    ev.sourceEvent.clientY,
                  );
                }),
            ),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('d', (d) => generator(d.points) ?? '');
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

  // Stub body references all new fields/imports so TS does not flag them as unused.
  // Task 2 replaces this with the real implementation.
  private renderLensBands(): void {
    if (!this.lensState || !this.lensSync) return;
    void (this.currentYearRange);
    void (COMBINED_CHART_KEY);
    void (renderLensBandsHelper);
  }
}
