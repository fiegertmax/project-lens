import { ChartArea } from './charts/ChartArea';
import {
  DATA_URL,
  DEFAULT_COUNTRIES,
  DEFAULT_METRIC,
  DEFAULT_YEAR_RANGE,
  EXTRA_COLUMNS,
} from './config';
import { EmissionsDataset } from './data/EmissionsDataset';
import { AppState } from './state/AppState';
import type { YearRange } from './state/AppState';
import { CountryLensState } from './state/CountryLensState';
import { AiResearchState } from './state/AiResearchState';
import { ConfigPanel } from './ui/ConfigPanel';
import { LensPanel } from './ui/LensPanel';
import { AiResearchPanel } from './ui/AiResearchPanel';

/** Composition root: loads data, wires state to the panel and chart stack. */
export class App {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async start(): Promise<void> {
    this.root.innerHTML = '<p class="app__loading">Loading emissions data…</p>';
    const dataset = await EmissionsDataset.load(DATA_URL, DEFAULT_METRIC, EXTRA_COLUMNS);

    const bounds = this.clampBounds(dataset.yearExtent());
    const range = this.clampRange(bounds);
    const state = new AppState(DEFAULT_COUNTRIES, range);
    const lensState = new CountryLensState();
    const aiResearch = new AiResearchState();

    this.render(dataset, state, lensState, aiResearch, bounds);
  }

  private render(
    dataset: EmissionsDataset,
    state: AppState,
    lensState: CountryLensState,
    aiResearch: AiResearchState,
    bounds: YearRange,
  ): void {
    this.root.innerHTML = '';
    this.root.className = 'app';

    const sidebar = document.createElement('aside');
    sidebar.className = 'app__sidebar';
    const main = document.createElement('main');
    main.className = 'app__main';
    this.root.append(sidebar, main);

    new ConfigPanel(sidebar, dataset, state, bounds, lensState);
    new LensPanel(sidebar, lensState, state, dataset);
    const aiResearchPanel = new AiResearchPanel(sidebar, aiResearch, dataset);
    const charts = new ChartArea(main, dataset, state, DEFAULT_METRIC, lensState, aiResearch);

    const syncView = (): void => {
      // AI research only makes sense on the absolute "find reasons" view.
      const isAbsolute = state.metricMode() === 'absolute';
      aiResearchPanel.root.style.display = isAbsolute ? '' : 'none';
      if (!isAbsolute) aiResearch.cancelSelection();

      charts.update();
    };

    state.subscribe(syncView);
    window.addEventListener('resize', syncView);
    syncView();
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
