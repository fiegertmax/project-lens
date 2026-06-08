import { ChartStack } from './charts/ChartStack';
import {
  DATA_URL,
  DEFAULT_COUNTRIES,
  DEFAULT_METRIC,
  DEFAULT_YEAR_RANGE,
} from './config';
import { EmissionsDataset } from './data/EmissionsDataset';
import { AppState } from './state/AppState';
import type { YearRange } from './state/AppState';
import { ConfigPanel } from './ui/ConfigPanel';

/** Composition root: loads data, wires state to the panel and chart stack. */
export class App {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    this.root.innerHTML = '<p class="app__loading">Loading emissions data…</p>';
    const dataset = await EmissionsDataset.load(DATA_URL, DEFAULT_METRIC);

    const bounds = this.clampBounds(dataset.yearExtent());
    const state = new AppState(DEFAULT_COUNTRIES, this.clampRange(bounds));

    this.render(dataset, state, bounds);
  }

  private render(
    dataset: EmissionsDataset,
    state: AppState,
    bounds: YearRange,
  ): void {
    this.root.innerHTML = '';
    this.root.className = 'app';

    const sidebar = document.createElement('aside');
    sidebar.className = 'app__sidebar';
    const main = document.createElement('main');
    main.className = 'app__main';
    this.root.append(sidebar, main);

    new ConfigPanel(sidebar, dataset, state, bounds);
    const charts = new ChartStack(main, dataset, state, DEFAULT_METRIC);

    state.subscribe(() => charts.update());
    window.addEventListener('resize', () => charts.update());
    charts.update();
  }

  /** Restrict the slider to years that actually carry data. */
  private clampBounds([min, max]: YearRange): YearRange {
    return [Math.max(min, 1900), max];
  }

  /** Fit the requested default range inside the available bounds. */
  private clampRange(bounds: YearRange): YearRange {
    const [from, to] = DEFAULT_YEAR_RANGE;
    return [Math.max(from, bounds[0]), Math.min(to, bounds[1])];
  }
}
