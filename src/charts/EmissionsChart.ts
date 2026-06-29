import {
  axisBottom,
  axisLeft,
  axisRight,
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
import type { AiResearchState } from '../state/AiResearchState';
import { resolveSeries, resolveSeriesBy } from '../utils/interpolation';
import { metricSpec, extraColumnFor } from '../utils/metricSpec';
import { getGdpPerCapita } from '../utils/getGdpPerCapita';
import type { LineDragCallbacks } from './drag-types';
import { renderLensBands as renderLensBandsHelper } from './LensBandRenderer';
import { SlopeChart } from './SlopeChart';
import { GdpSlopeChart } from './GdpSlopeChart';
import { LensScatterPlot } from './LensScatterPlot';
import { CrosshairOverlay } from './CrosshairOverlay';
import type { CrosshairEntry } from './CrosshairOverlay';
import { crossCountrySum } from '../utils/crossCountryMean';

export const CHART_MARGIN = { top: 12, right: 72, bottom: 28, left: 72 };
const MARGIN = CHART_MARGIN;
const HEIGHT = 360;
const YEAR_FORMAT = format('d');
// Secondary GDP/capita line — kept in sync with GdpSlopeChart's GDP color.
const GDP_COLOR = '#2e86c1';
const GDP_FORMAT = format('$.2~s');
const GDP_TOOLTIP_FORMAT = format('$,.0f');

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

  private countries: string[];
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;

  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly labelEl: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly labelNameEl: Selection<HTMLSpanElement, unknown, null, undefined>;
  private readonly legendEl: Selection<HTMLDivElement, unknown, null, undefined>;
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
  private lensUnsub: (() => void) | null = null;

  private aiResearch: AiResearchState | null = null;
  private aiUnsub: (() => void) | null = null;

  private readonly unsub: () => void;

  colorFor?: (c: string) => string;
  callbacks?: LineDragCallbacks;

  constructor(
    chartId: string,
    parent: HTMLElement,
    initialCountries: string[],
    dataset: EmissionsDataset,
    state: AppState,
  ) {
    this.chartId = chartId;
    this.countries = [...initialCountries];
    this.dataset = dataset;
    this.state = state;

    this.root = select(parent)
      .append('div')
      .attr('class', 'emissions-chart chart-area__row')
      .attr('data-chart-id', chartId);

    this.labelEl = this.root.append('div').attr('class', 'emissions-chart__label');
    this.labelNameEl = this.labelEl.append('span').attr('class', 'emissions-chart__label-name');
    this.legendEl = this.labelEl.append('div').attr('class', 'emissions-chart__legend');

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
    // Hovering a scatter dot highlights its country across line, legend and dots.
    this.scatterPlot.onHoverCountry = (c) =>
      c ? this.highlight(c) : this.clearHighlight();

    this.unsub = state.subscribe(() => this.update());
    this.syncModeAttrs();
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.lensUnsub?.();
    this.aiUnsub?.();
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

  setLensState(state: CountryLensState): void {
    this.lensUnsub?.();
    this.lensState = state;
    this.lensUnsub = state.subscribe(() => this.renderLenses());
    this.renderLenses();
  }

  /** Wires the AI-research selection highlight to this chart's single-country slope. */
  setAiResearch(state: AiResearchState): void {
    this.aiUnsub?.();
    this.aiResearch = state;
    this.aiUnsub = state.subscribe(() => this.applyResearchSelectable());
    this.applyResearchSelectable();
  }

  /**
   * Marks the single-country absolute slope chart selectable while research selection
   * is armed. Only single-country, absolute-mode charts with placed lenses qualify —
   * exactly the charts that "represent one country".
   */
  private applyResearchSelectable(): void {
    const st = this.aiResearch;
    if (!st) return;
    const eligible =
      !this.isMulti() &&
      this.countries.length === 1 &&
      this.state.metricMode() === 'absolute' &&
      !!this.lensState &&
      this.lensState.get() !== null;
    const active = eligible && st.mode() === 'selecting';
    this.singleSlopeChart.setSelectable(active, () => {
      const lens = this.lensState!.get();
      st.select({
        country: this.countries[0],
        lenses: lens ? [lens] : [],
        includeLUC: this.state.includeLandUseChange(),
      });
    });
  }

  update(): void {
    if (this.countries.length === 0) {
      this.clearPlot();
      return;
    }

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
    // In single mode a second GDP/capita line answers "did emissions track
    // wealth?" directly on the base chart — no lens required. It also owns the
    // single-country legend (CO₂ vs GDP).
    const gdpEntry = this.renderGdpOverlay(x, color, spec, innerW, innerH);
    // Multi mode keeps its country legend in sync with the drawn series.
    if (this.isMulti()) this.renderLegend(this.countries, color, innerW);

    if (this.lensState) {
      this.renderLensBandsInternal(x, yearRange, innerW, innerH);
    }

    const crosshairEntries: CrosshairEntry[] = entries.map((e) => ({
      label: e.country,
      color: color(e.country),
      points: e.points,
    }));
    if (gdpEntry) crosshairEntries.push(gdpEntry);
    this.crosshair.setData(x, y, innerH, crosshairEntries, spec.valueLabel);

    // Update label in single mode
    if (!this.isMulti()) {
      this.labelNameEl.text(this.countries[0] ?? '');
    }

    // Re-render slope if the lens is active (preserves state after update() calls)
    if (this.lensState) {
      const lens = this.lensState.get();
      if (lens) this.renderSlopeForState([lens]);
    }
  }

  private syncModeAttrs(): void {
    const multi = this.isMulti();
    this.root.classed('emissions-chart--multi', multi);
    // data-country is used by LensPanel for the per-capita GDP availability check
    this.root.attr('data-country', !multi ? (this.countries[0] ?? null) : null);
    if (!multi && this.countries[0]) {
      this.labelNameEl.text(this.countries[0]);
    }
  }

  private resolveColor(): (c: string) => string {
    return this.colorFor
      ?? ((c: string) => scaleOrdinal(this.countries, schemeTableau10 as readonly string[])(c));
  }

  private renderLenses(): void {
    if (!this.lensState) return;
    const active = this.lensState.get() !== null;
    this.root.classed('emissions-chart--lens-active', active);
    this.update();

    if (!active) {
      this.clearAllSubCharts();
      return;
    }

    requestAnimationFrame(() => {
      const lens = this.lensState?.get();
      if (lens) this.renderSlopeForState([lens]);
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
          lenses,
          undefined,
          excludeSources,
        );
        this.applyResearchSelectable();
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
    const includeLUC = this.state.includeLandUseChange();
    const aggregated = crossCountrySum(this.countries, lenses, this.dataset, includeLUC);
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
      .attr('d', (d) => generator(d.points) ?? '');

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
            .on('mouseover', (_ev, d) => { if (self.isMulti()) self.highlight(d.country); })
            .on('mouseout', () => { if (self.isMulti()) self.clearHighlight(); })
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

  private clearLegend(): void {
    this.group('legend').selectAll('*').remove();
  }

  /**
   * Single-country only: overlays a GDP-per-capita line on a secondary right
   * axis. GDP/cap is derived (gdp / population) — no precomputed column exists.
   * Clears itself in multi mode or when the country lacks GDP data.
   */
  private renderGdpOverlay(
    x: LinearScale,
    color: (c: string) => string,
    spec: { label: string },
    innerW: number,
    innerH: number,
  ): CrosshairEntry | null {
    const country = !this.isMulti() ? this.countries[0] : undefined;
    const series = country ? this.dataset.series(country) : undefined;
    const points = series
      ? resolveSeriesBy(series, this.state.yearRange(), getGdpPerCapita)
      : [];
    if (points.length === 0) {
      this.clearGdpOverlay();
      return null;
    }

    const max = Math.max(...points.map((p) => p.value));
    const yR = scaleLinear().domain([0, max || 1]).nice().range([innerH, 0]);

    this.group('y-axis-right')
      .attr('transform', `translate(${innerW},0)`)
      .style('color', GDP_COLOR)
      .transition().duration(400)
      .call(axisRight(yR).ticks(5).tickFormat((d) => GDP_FORMAT(Number(d))));

    this.group('y-title-right')
      .selectAll<SVGTextElement, string>('text')
      .data(['GDP per capita (int-$)'])
      .join('text')
      .attr('transform', `translate(${innerW + MARGIN.right - 14},${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('fill', GDP_COLOR)
      .attr('font-size', '11px')
      .text((d) => d);

    const generator = line<DataPoint>().x((p) => x(p.year)).y((p) => yR(p.value));
    this.group('gdp-line')
      .selectAll<SVGPathElement, DataPoint[]>('path.gdp-line')
      .data([points])
      .join('path')
      .attr('class', 'gdp-line')
      .attr('fill', 'none')
      .attr('stroke', GDP_COLOR)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5 3')
      .attr('d', (d) => generator(d) ?? '');

    this.renderSingleLegend(country!, color, spec.label);

    // Surfaced in the hover tooltip on its own scale/format alongside the CO₂ value.
    return {
      label: 'GDP per capita',
      color: GDP_COLOR,
      points,
      yScale: yR,
      format: GDP_TOOLTIP_FORMAT,
    };
  }

  private clearGdpOverlay(): void {
    this.group('y-axis-right').selectAll('*').remove();
    this.group('y-title-right').selectAll('*').remove();
    this.group('gdp-line').selectAll('*').remove();
    this.legendEl.selectAll('*').remove();
  }

  /**
   * Compact horizontal key beside the country headline (not inside the plot, so
   * it never overlaps the lines) identifying the CO₂ and GDP lines.
   */
  private renderSingleLegend(
    country: string,
    color: (c: string) => string,
    co2Label: string,
  ): void {
    const rows = [
      { color: color(country), label: co2Label, dash: false },
      { color: GDP_COLOR, label: 'GDP per capita', dash: true },
    ];
    const items = this.legendEl
      .selectAll<HTMLDivElement, (typeof rows)[number]>('div.emissions-chart__legend-item')
      .data(rows, (d) => d.label)
      .join('div')
      .attr('class', 'emissions-chart__legend-item');

    items
      .selectAll<HTMLSpanElement, (typeof rows)[number]>('span.emissions-chart__legend-swatch')
      .data((d) => [d])
      .join('span')
      .attr('class', 'emissions-chart__legend-swatch')
      .classed('emissions-chart__legend-swatch--dashed', (d) => d.dash)
      .style('border-color', (d) => d.color);

    items
      .selectAll<HTMLSpanElement, (typeof rows)[number]>('span.emissions-chart__legend-label')
      .data((d) => [d])
      .join('span')
      .attr('class', 'emissions-chart__legend-label')
      .text((d) => d.label);
  }

  /** Removes all drawn series + legend when no country is selected. */
  private clearPlot(): void {
    this.group('lines').selectAll('path.emissions-line').remove();
    this.group('drag-overlays').selectAll('path.emissions-line-hit').remove();
    this.group('empty').selectAll('text').remove();
    this.clearLegend();
    this.clearGdpOverlay();
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
    if (!this.lensState) return;
    renderLensBandsHelper({
      plot: this.plot,
      lens: this.lensState.get(),
      x,
      yearRange,
      innerW,
      innerH,
      lensState: this.lensState,
      getContainerWidth: () => this.lineCell.node()!.clientWidth || 600,
      onChange: () => {
        const lens = this.lensState?.get();
        if (lens) requestAnimationFrame(() => this.renderSlopeForState([lens]));
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
    this.scatterPlot.highlightCountry(country);
  }

  private clearHighlight(): void {
    this.group('lines')
      .selectAll<SVGPathElement, SeriesEntry>('path.emissions-line')
      .transition().duration(100).attr('opacity', 1);
    this.group('legend')
      .selectAll<SVGGElement, string>('g.legend-row')
      .transition().duration(100).attr('opacity', 1);
    this.scatterPlot.highlightCountry(null);
  }

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
