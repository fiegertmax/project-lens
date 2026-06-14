import { ChartStack } from './charts/ChartStack';
import { PieChart } from './charts/PieChart';
import { PieLensManager } from './charts/PieLensManager';
import { SankeyChart } from './charts/SankeyChart';
import {
  DATA_URL,
  DEFAULT_COUNTRIES,
  DEFAULT_GLOBAL_YEAR,
  DEFAULT_LENS_EFFECT,
  DEFAULT_METRIC,
  DEFAULT_YEAR_RANGE,
  EXTRA_COLUMNS,
  LENS_WIDTH,
} from './config';
import { EmissionsDataset } from './data/EmissionsDataset';
import { AppState } from './state/AppState';
import type { YearRange } from './state/AppState';
import { LensState } from './state/LensState';
import { PieLensState } from './state/PieLensState';
import { ConfigPanel } from './ui/ConfigPanel';
import { LensPanel } from './ui/LensPanel';
import { PieLensPanel } from './ui/PieLensPanel';
import { SankeyLensPanel } from './ui/SankeyLensPanel';

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
    const state = new AppState(DEFAULT_COUNTRIES, range, this.clampYear(DEFAULT_GLOBAL_YEAR, bounds));
    const lens = new LensState(
      DEFAULT_LENS_EFFECT,
      LENS_WIDTH.default,
      Math.round((range[0] + range[1]) / 2),
    );
    const pieLens = new PieLensState();

    this.render(dataset, state, lens, pieLens, bounds);
  }

  private render(
    dataset: EmissionsDataset,
    state: AppState,
    lens: LensState,
    pieLens: PieLensState,
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
    const lensPanel = new LensPanel(sidebar, lens);
    const sankeyLensPanel = new SankeyLensPanel(sidebar);
    const charts = new ChartStack(main, dataset, state, lens, DEFAULT_METRIC);
    const sankey = new SankeyChart(main, dataset);
    const pie = new PieChart(main, dataset);
    const pieManager = new PieLensManager({
      overlay: pie.overlay(),
      chartRoot: pie.node(),
      state: pieLens,
      dataset,
      getYear: () => state.globalYear(),
    });
    const pieLensPanel = new PieLensPanel(sidebar, pieLens, pieManager, pie.overlay());

    const syncView = (): void => {
      const isByCountry = state.activeTab() === 'by-country';
      const isGlobalSankey = !isByCountry && state.globalVizMode() === 'sankey';
      const isGlobalPie = !isByCountry && state.globalVizMode() === 'pie';

      charts.node().style.display = isByCountry ? '' : 'none';
      sankey.node().style.display = isGlobalSankey ? '' : 'none';
      pie.node().style.display = isGlobalPie ? '' : 'none';
      lensPanel.root.style.display = isByCountry ? '' : 'none';
      sankeyLensPanel.root.style.display = isGlobalSankey ? '' : 'none';
      pieLensPanel.root.style.display = isGlobalPie ? '' : 'none';

      if (!isGlobalPie) pieLens.clear();

      if (isByCountry) charts.update();
      else if (isGlobalSankey) {
        sankey.update(state.globalYear(), state.focusedContinent());
        sankeyLensPanel.update(state.focusedContinent() !== null);
      } else {
        pie.update(state.globalYear(), state.focusedContinent());
        pieManager.redrawAll();
      }
    };

    state.subscribe(syncView);
    lens.subscribe(() => {
      if (state.activeTab() === 'by-country') charts.update();
    });
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

  /** Clamp the default global year inside the available bounds. */
  private clampYear(year: number, [min, max]: YearRange): number {
    return Math.min(Math.max(year, min), max);
  }
}
