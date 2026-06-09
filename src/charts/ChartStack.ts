import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { CountrySeries, MetricDefinition } from '../data/types';
import { LENS_EFFECTS } from '../lens/effects';
import type { AppState, YearRange } from '../state/AppState';
import type { LensState } from '../state/LensState';
import { resolveSeries } from '../utils/interpolation';
import type { LensRenderContext } from './LineChart';
import { LineChart } from './LineChart';

/** Vertical, scrollable stack of one LineChart per selected country. */
export class ChartStack {
  private readonly container: HTMLDivElement;
  private readonly charts = new Map<string, LineChart>();
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  private readonly lens: LensState;
  private readonly metric: MetricDefinition;

  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    lens: LensState,
    metric: MetricDefinition,
  ) {
    this.dataset = dataset;
    this.state = state;
    this.lens = lens;
    this.metric = metric;
    this.container = document.createElement('div');
    this.container.className = 'chart-stack';
    parent.appendChild(this.container);
  }

  /** Reconcile charts with the current selection, year range, and lens. */
  update(): void {
    const countries = this.state.selectedCountries().sort((a, b) =>
      a.localeCompare(b),
    );
    this.removeDeselected(new Set(countries));
    this.renderEmptyHint(countries.length === 0);

    const yearRange = this.state.yearRange();
    for (const country of countries) {
      const chart = this.ensureChart(country);
      const series = this.dataset.series(country);
      chart.update(series ? resolveSeries(series, yearRange) : [], yearRange);
      this.container.appendChild(chart.node()); // re-append enforces order
      chart.applyLens(this.lensContext(country, series, yearRange));
    }
  }

  private lensContext(
    country: string,
    series: CountrySeries | undefined,
    yearRange: YearRange,
  ): LensRenderContext | null {
    const phase = this.lens.currentPhase();
    if (phase === 'idle') return null;

    const isTarget = this.lens.isTarget(country);
    if (phase === 'active' && !isTarget) return null;

    const effect = LENS_EFFECTS[this.lens.currentEffect()];
    const window = this.lensWindow(yearRange);
    const derived =
      phase === 'active' && isTarget && series
        ? effect.compute(series.points, window)
        : [];

    return {
      phase,
      isTarget,
      window,
      derived,
      unit: effect.unit,
      onToggle: () => this.lens.toggleTarget(country),
      onSetCenter: (year) => this.lens.setCenter(this.clampCenter(year, yearRange)),
      onResizeBy: (delta) => this.lens.setWidth(this.lens.currentWidth() + delta),
    };
  }

  /** Lens window clamped inside the visible year range. */
  private lensWindow(range: YearRange): YearRange {
    const half = this.lens.currentWidth() / 2;
    const center = this.clampCenter(this.lens.centerYear(), range);
    return [Math.max(range[0], center - half), Math.min(range[1], center + half)];
  }

  private clampCenter(year: number, [lo, hi]: YearRange): number {
    const half = this.lens.currentWidth() / 2;
    if (hi - lo <= half * 2) return (lo + hi) / 2;
    return Math.min(hi - half, Math.max(lo + half, year));
  }

  private ensureChart(country: string): LineChart {
    let chart = this.charts.get(country);
    if (!chart) {
      chart = new LineChart(this.container, country, this.metric);
      this.charts.set(country, chart);
    }
    return chart;
  }

  private removeDeselected(keep: Set<string>): void {
    for (const [country, chart] of this.charts) {
      if (keep.has(country)) continue;
      chart.destroy();
      this.charts.delete(country);
    }
  }

  private renderEmptyHint(show: boolean): void {
    let hint = this.container.querySelector<HTMLParagraphElement>('.chart-stack__hint');
    if (show && !hint) {
      hint = document.createElement('p');
      hint.className = 'chart-stack__hint';
      hint.textContent = 'Select one or more countries to display charts.';
      this.container.appendChild(hint);
    } else if (!show && hint) {
      hint.remove();
    }
  }
}
