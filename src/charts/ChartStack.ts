import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { MetricDefinition } from '../data/types';
import type { AppState } from '../state/AppState';
import { resolveSeries } from '../utils/interpolation';
import { LineChart } from './LineChart';

/** Vertical, scrollable stack of one LineChart per selected country. */
export class ChartStack {
  private readonly container: HTMLDivElement;
  private readonly charts = new Map<string, LineChart>();
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  private readonly metric: MetricDefinition;

  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    metric: MetricDefinition,
  ) {
    this.dataset = dataset;
    this.state = state;
    this.metric = metric;
    this.container = document.createElement('div');
    this.container.className = 'chart-stack';
    parent.appendChild(this.container);
  }

  /** Reconcile charts with the current selection and year range. */
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
    }
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
