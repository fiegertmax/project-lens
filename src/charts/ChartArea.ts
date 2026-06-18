import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { MetricDefinition } from '../data/types';
import type { AppState } from '../state/AppState';
import { CombinedChart } from './CombinedChart';

/** Thin container that holds one CombinedChart; Phase 2 extends this with extracted-country logic. */
export class ChartArea {
  private readonly div: HTMLDivElement;
  private readonly chart: CombinedChart;

  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    metric: MetricDefinition,
  ) {
    this.div = document.createElement('div');
    this.div.className = 'chart-area';
    parent.appendChild(this.div);
    this.chart = new CombinedChart(this.div, dataset, state, metric);
  }

  /** Root element used by app.ts to toggle visibility. */
  node(): HTMLDivElement {
    return this.div;
  }

  update(): void {
    this.chart.update();
  }

  destroy(): void {
    this.chart.destroy();
  }
}
