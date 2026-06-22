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
import type { DataPoint } from '../data/types';
import type { AppState } from '../state/AppState';
import type { CountryLensState, PlacedLens } from '../state/CountryLensState';
import { resolveSeries } from '../utils/interpolation';
import { metricSpec, extraColumnFor } from '../utils/metricSpec';
import type { LineDragCallbacks } from './drag-types';
import type { LensSync } from './LensSync';
import { renderLensBands as renderLensBandsHelper } from './LensBandRenderer';
import { SlopeChart } from './SlopeChart';
import { GdpSlopeChart } from './GdpSlopeChart';
import { LensScatterPlot } from './LensScatterPlot';
import { CrosshairOverlay } from './CrosshairOverlay';
import { crossCountrySum } from '../utils/crossCountryMean';
import type { StagedLensWindow } from './slope-types';

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

/**
 * Unified emissions line chart that replaces CombinedChart + SingleCountryChart.
 * Shows N countries on one shared SVG. Behavior switches on isMulti() (countries.length > 1):
 *   - single: country label, individual emission-source slope, GDP slope for per-capita
 *   - multi:  legend, cross-country aggregated slope, scatter plot for per-capita
 */
export class EmissionsChart {
  readonly chartId: string;
  readonly lensKey: string;

  private countries: string[];
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;

  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly labelEl: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly lineCell: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly slopeCell: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;
  private readonly crosshair: CrosshairOverlay;

  // Sub-charts — all appended to slopeCell, visibility controlled via display style
  private readonly singleSlopeChart: SlopeChart;   // single + absolute
  private readonly gdpSlopeChart: GdpSlopeChart;   // single + per-capita
  private readonly multiSlopeChart: SlopeChart;    // multi + absolute
  private readonly scatterPlot: LensScatterPlot;   // multi + per-capita

  private lensState: CountryLensState | null = null;
  private lensSync: LensSync | null = null;
  private lensUnsub: (() => void) | null = null;

  private readonly unsub: () => void;

  colorFor?: (c: string) => string;
  callbacks?: LineDragCallbacks;

  constructor(
    chartId: string,
    lensKey: string,
    parent: HTMLElement,
    initialCountries: string[],
    dataset: EmissionsDataset,
    state: AppState,
  ) {
    this.chartId = chartId;
    this.lensKey = lensKey;
    this.countries = [...initialCountries];
    this.dataset = dataset;
    this.state = state;

    this.root = select(parent)
      .append('div')
      .attr('class', 'emissions-chart chart-area__row')
      .attr('data-chart-id', chartId)
      .attr('data-lens-key', lensKey);

    this.labelEl = this.root.append('div').attr('class', 'emissions-chart__label');

    const body = this.root.append('div').attr('class', 'emissions-chart__body');
    this.lineCell = body.append('div').attr('class', 'emissions-chart__line');
    this.slopeCell = body.append('div').attr('class', 'emissions-chart__slope');

    this.svg = this.lineCell.append('svg').attr('class', 'emissions-chart__svg');
    this.plot = this.svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
    this.crosshair = new CrosshairOverlay(this.svg, this.plot, '.emissions-line-hit');

    this.singleSlopeChart = new SlopeChart(this.slopeCell.node()!, dataset);
    this.gdpSlopeChart = new GdpSlopeChart(this.slopeCell.node()!, dataset);
    this.multiSlopeChart = new SlopeChart(this.slopeCell.node()!, dataset);
    this.scatterPlot = new LensScatterPlot(this.slopeCell.node()!, dataset);

    this.unsub = state.subscribe(() => this.update());
    this.syncModeAttrs();
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.lensUnsub?.();
    this.unsub();
    this.crosshair.destroy();
    this.singleSlopeChart.destroy();
    this.gdpSlopeChart.destroy();
    this.multiSlopeChart.destroy();
    this.scatterPlot.destroy();
    this.root.remove();
  }

  isMulti(): boolean {
    return this.countries.length > 1;
  }

  updateCountries(countries: string[]): void {
    this.countries = [...countries];
    this.syncModeAttrs();
    this.update();
  }

  setLensState(state: CountryLensState, sync: LensSync): void {
    this.lensUnsub?.();
    this.lensState = state;
    this.lensSync = sync;
    this.lensUnsub = state.subscribe(() => this.renderLenses());
    this.renderLenses();
  }

  update(): void {
    if (this.countries.length === 0) return;

    const width = this.lineCell.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const yearRange = this.state.yearRange();
    this.root.attr('data-year-start', yearRange[0]).attr('data-year-end', yearRange[1]);

    const includeLUC = this.state.includeLandUseChange();
    const metricMode = this.state.metricMode();
    const extraColumn = extraColumnFor(metricMode, includeLUC);
    const entries: SeriesEntry[] = this.countries.map((c) => {
      const series = this.dataset.series(c);
      return { country: c, points: series ? resolveSeries(series, yearRange, extraColumn) : [] };
    });

    const x = scaleLinear().domain(yearRange).range([0, innerW]);
    const [yMin, yMax] = computeYDomain(entries);
    const y = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    const color = this.resolveColor();
    const spec = metricSpec(metricMode, includeLUC);

    this.renderAxes(x, y, innerH, spec);
    this.renderLines(entries, x, y, color, innerW, innerH);
    if (this.isMulti()) this.renderLegend(this.countries, color, innerW);

    if (this.lensState && this.lensSync) {
      this.renderLensBandsInternal(x, yearRange, innerW, innerH);
    }

    this.crosshair.setData(
      x, y, innerH,
      entries.map((e) => ({ label: e.country, color: color(e.country), points: e.points })),
      spec.valueLabel,
    );

    // Update label in single mode
    if (!this.isMulti()) {
      this.labelEl.text(this.countries[0] ?? '');
    }

    // Re-render slope if lenses are active (preserves state after update() calls)
    if (this.lensState) {
      const lenses = this.lensState.lensesFor(this.lensKey);
      if (lenses.length > 0) this.renderSlopeForState(lenses);
    }
  }

  private syncModeAttrs(): void {
    const multi = this.isMulti();
    this.root.classed('emissions-chart--multi', multi);
    // data-country is used by LensStagePanel for per-capita GDP availability check
    this.root.attr('data-country', !multi ? (this.countries[0] ?? null) : null);
    if (!multi && this.countries[0]) {
      this.labelEl.text(this.countries[0]);
    }
  }

  private resolveColor(): (c: string) => string {
    return this.colorFor
      ?? ((c: string) => scaleOrdinal(this.countries, schemeTableau10 as readonly string[])(c));
  }

  private renderLenses(): void {
    if (!this.lensState) return;
    const lenses = this.lensState.lensesFor(this.lensKey);
    const active = lenses.length > 0;
    this.root.classed('emissions-chart--lens-active', active);
    this.update();

    if (!active) {
      this.clearAllSubCharts();
      return;
    }

    requestAnimationFrame(() => {
      if (!this.lensState) return;
      const ls = this.lensState.lensesFor(this.lensKey);
      if (ls.length > 0) this.renderSlopeForState(ls);
    });
  }

  private renderSlopeForState(lenses: PlacedLens[]): void {
    const perCapita = this.state.metricMode() === 'per-capita';
    const includeLUC = this.state.includeLandUseChange();

    if (!this.isMulti()) {
      // Single-country mode
      this.multiSlopeChart.node().style.display = 'none';
      this.multiSlopeChart.clear();
      this.scatterPlot.node().style.display = 'none';
      this.scatterPlot.clear();

      if (perCapita) {
        this.singleSlopeChart.node().style.display = 'none';
        this.singleSlopeChart.clear();
        this.gdpSlopeChart.node().style.display = '';
        this.gdpSlopeChart.onSwitchToAbsolute = () => this.state.setMetricMode('absolute');
        this.gdpSlopeChart.render(this.countries[0], lenses, includeLUC);
      } else {
        this.gdpSlopeChart.node().style.display = 'none';
        this.gdpSlopeChart.clear();
        this.singleSlopeChart.node().style.display = '';
        const excludeSources = includeLUC ? undefined : new Set(['land_use_change_co2']);
        this.singleSlopeChart.render(
          this.countries[0],
          lenses.map((l) => ({ stage: l.stage, startYear: l.startYear, endYear: l.endYear })),
          undefined,
          excludeSources,
        );
      }
    } else {
      // Multi-country mode
      this.singleSlopeChart.node().style.display = 'none';
      this.singleSlopeChart.clear();
      this.gdpSlopeChart.node().style.display = 'none';
      this.gdpSlopeChart.clear();

      if (perCapita) {
        this.multiSlopeChart.node().style.display = 'none';
        this.multiSlopeChart.clear();
        this.scatterPlot.node().style.display = '';
        this.scatterPlot.render(this.countries, lenses, includeLUC, this.resolveColor());
      } else {
        this.scatterPlot.node().style.display = 'none';
        this.scatterPlot.clear();
        this.multiSlopeChart.node().style.display = '';
        this.renderSlopeMulti(lenses);
      }
    }
  }

  private renderSlopeMulti(lenses: PlacedLens[]): void {
    const windows: StagedLensWindow[] = lenses.map((l) => ({
      stage: l.stage,
      startYear: l.startYear,
      endYear: l.endYear,
    }));
    const includeLUC = this.state.includeLandUseChange();
    const aggregated = crossCountrySum(this.countries, windows, this.dataset, includeLUC);
    this.multiSlopeChart.renderAggregated(aggregated);
  }

  private clearAllSubCharts(): void {
    this.singleSlopeChart.clear();
    this.gdpSlopeChart.clear();
    this.multiSlopeChart.clear();
    this.scatterPlot.clear();
  }

  private renderAxes(
    x: LinearScale,
    y: LinearScale,
    innerH: number,
    spec: { label: string; unit: string },
  ): void {
    this.group('x-axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(x).ticks(8).tickFormat((d) => YEAR_FORMAT(Number(d))));
    this.group('y-axis').transition().duration(400).call(axisLeft(y).ticks(5));
    this.group('y-title')
      .selectAll<SVGTextElement, string>('text')
      .data([`${spec.label} (${spec.unit})`])
      .join('text')
      .attr('class', 'emissions-chart__y-title')
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
      .selectAll<SVGPathElement, SeriesEntry>('path.emissions-line')
      .data(entries.filter(Boolean), (d) => d?.country ?? '')
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'emissions-line')
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
      .on('mouseover', (_event, d) => { if (this.isMulti()) this.highlight(d.country); })
      .on('mouseout', () => { if (this.isMulti()) this.clearHighlight(); });

    this.renderDragOverlays(entries, generator);
    this.renderEmptyNotice(entries, innerW, innerH);
  }

  private renderDragOverlays(
    entries: SeriesEntry[],
    generator: (points: DataPoint[]) => string | null,
  ): void {
    const self = this;
    this.group('drag-overlays')
      .selectAll<SVGPathElement, SeriesEntry>('path.emissions-line-hit')
      .data(entries.filter(Boolean), (d) => d?.country ?? '')
      .join(
        (enter) =>
          enter
            .append('path')
            .attr('class', 'emissions-line-hit')
            .attr('fill', 'none')
            .attr('stroke', 'transparent')
            .attr('stroke-width', 12)
            .attr('pointer-events', 'stroke')
            .attr('cursor', 'grab')
            .call(
              drag<SVGPathElement, SeriesEntry>()
                .on('start', function (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) {
                  if (self.isMulti()) {
                    self
                      .group('lines')
                      .select<SVGPathElement>(`path.emissions-line[data-country="${d.country}"]`)
                      .attr('opacity', 0.2);
                  }
                  self.callbacks?.onDragStart(d.country, ev.sourceEvent.clientX, ev.sourceEvent.clientY);
                })
                .on('drag', function (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) {
                  self.callbacks?.onDragMove(d.country, ev.sourceEvent.clientX, ev.sourceEvent.clientY);
                })
                .on('end', function (ev: D3DragEvent<SVGPathElement, SeriesEntry, unknown>, d) {
                  if (self.isMulti()) {
                    self
                      .group('lines')
                      .select<SVGPathElement>(`path.emissions-line[data-country="${d.country}"]`)
                      .attr('opacity', 1);
                  }
                  self.callbacks?.onDragEnd(d.country, ev.sourceEvent.clientX, ev.sourceEvent.clientY);
                }),
            ),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('d', (d) => generator(d.points) ?? '');
  }

  private renderLegend(countries: string[], color: (c: string) => string, innerW: number): void {
    const legendGroup = this.group('legend').attr('transform', `translate(${innerW - 120},0)`);
    legendGroup.selectAll('rect.legend-bg').remove();

    legendGroup
      .selectAll<SVGGElement, string>('g.legend-row')
      .data(countries, (d) => d)
      .join(
        (enter) => enter.append('g').attr('class', 'legend-row'),
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('transform', (_d, i) => `translate(0,${i * 18})`)
      .attr('cursor', 'default')
      .call((row) => {
        row
          .selectAll<SVGCircleElement, string>('circle.legend-swatch')
          .data((d) => [d])
          .join('circle')
          .attr('class', 'legend-swatch')
          .attr('cx', 5)
          .attr('cy', 5)
          .attr('r', 5)
          .attr('fill', (d) => color(d));
        row
          .selectAll<SVGTextElement, string>('text.legend-label')
          .data((d) => [d])
          .join('text')
          .attr('class', 'legend-label')
          .attr('x', 14)
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

  private renderLensBandsInternal(
    x: LinearScale,
    yearRange: [number, number],
    innerW: number,
    innerH: number,
  ): void {
    if (!this.lensState || !this.lensSync) return;
    const lenses = this.lensState.lensesFor(this.lensKey);
    renderLensBandsHelper({
      plot: this.plot,
      lenses,
      x,
      yearRange,
      innerW,
      innerH,
      key: this.lensKey,
      lensState: this.lensState,
      lensSync: this.lensSync,
      getContainerWidth: () => this.lineCell.node()!.clientWidth || 600,
      onChange: () => {
        const ls = this.lensState?.lensesFor(this.lensKey) ?? [];
        if (ls.length > 0) requestAnimationFrame(() => this.renderSlopeForState(ls));
        this.update();
      },
    });
  }

  private highlight(country: string): void {
    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.emissions-line')
      .transition().duration(100)
      .attr('opacity', (d) => (d.country === country ? 1 : 0.15));
    this.group('legend')
      .selectAll<SVGGElement, string>('g.legend-row')
      .transition().duration(100)
      .attr('opacity', (d) => (d === country ? 1 : 0.15));
  }

  private clearHighlight(): void {
    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.emissions-line')
      .transition().duration(100).attr('opacity', 1);
    this.group('legend')
      .selectAll<SVGGElement, string>('g.legend-row')
      .transition().duration(100).attr('opacity', 1);
  }

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
