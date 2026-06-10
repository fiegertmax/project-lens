import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { MetricDefinition } from '../data/types';
import { LENS_EFFECTS } from '../lens/effects';
import type { DerivedPoint } from '../lens/effects';
import type { AppState, YearRange } from '../state/AppState';
import type { LensState } from '../state/LensState';
import { resolveSeries } from '../utils/interpolation';
import type { LensControl, LensRenderContext } from './LineChart';
import { LineChart } from './LineChart';

/** Vertical, scrollable stack of one LineChart per selected country. */
export class ChartStack {
  private readonly container: HTMLDivElement;
  private readonly charts = new Map<string, LineChart>();
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  private readonly lens: LensState;
  private readonly metric: MetricDefinition;
  /** Guards against re-entrant renders when pruning targets notifies mid-update. */
  private rendering = false;

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
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.render();
    } finally {
      this.rendering = false;
    }
  }

  private render(): void {
    const countries = this.state.selectedCountries().sort((a, b) =>
      a.localeCompare(b),
    );
    this.removeDeselected(new Set(countries));
    this.renderEmptyHint(countries.length === 0);

    const yearRange = this.state.yearRange();
    const window = this.lensWindow(yearRange);
    const derived = this.deriveTargets(countries, window);
    const sharedDomain = this.comparisonDomain(derived);

    for (const country of countries) {
      const chart = this.ensureChart(country);
      const series = this.dataset.series(country);
      chart.update(series ? resolveSeries(series, yearRange) : [], yearRange);
      this.container.appendChild(chart.node()); // re-append enforces order
      const ctx = this.lensContext(country, yearRange, window, derived, sharedDomain);
      chart.applyLens(ctx);
      chart.setLensControl(this.lensControl(country));
    }
  }

  /** Header +/− toggle for a displayed country, or null when the lens is off. */
  private lensControl(country: string): LensControl | null {
    if (this.lens.currentPhase() !== 'active') return null;
    return {
      isTarget: this.lens.isTarget(country),
      onToggle: () => this.lens.toggleTarget(country),
    };
  }

  /** Derived lens series for every active target, keyed by country. */
  private deriveTargets(
    countries: string[],
    window: YearRange,
  ): Map<string, DerivedPoint[]> {
    const derived = new Map<string, DerivedPoint[]>();
    if (this.lens.currentPhase() !== 'active') return derived;
    const effect = LENS_EFFECTS[this.lens.currentEffect()];
    for (const country of countries) {
      const series = this.dataset.series(country);
      if (this.lens.isTarget(country) && series)
        derived.set(country, effect.compute(series.points, window));
    }
    return derived;
  }

  /** Shared [min, max] across all lensed countries, or undefined when off/single. */
  private comparisonDomain(
    derived: Map<string, DerivedPoint[]>,
  ): [number, number] | undefined {
    if (!this.lens.comparisonEnabled() || derived.size < 2) return undefined;
    let min = 0;
    let max = 0;
    let found = false;
    for (const points of derived.values())
      for (const { value } of points) {
        if (!Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
        found = true;
      }
    return found ? [min, max] : undefined;
  }

  /** A render context only for countries the active lens currently targets. */
  private lensContext(
    country: string,
    yearRange: YearRange,
    window: YearRange,
    derived: Map<string, DerivedPoint[]>,
    sharedDomain: [number, number] | undefined,
  ): LensRenderContext | null {
    if (this.lens.currentPhase() !== 'active' || !this.lens.isTarget(country))
      return null;

    const effect = LENS_EFFECTS[this.lens.currentEffect()];
    return {
      window,
      derived: derived.get(country) ?? [],
      sharedDomain,
      label: effect.label,
      unit: effect.unit,
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
      // A removed chart can't be lensed — drop any stale target.
      if (this.lens.isTarget(country)) this.lens.toggleTarget(country);
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
