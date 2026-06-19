import { ChartArea } from './charts/ChartArea';
import { PieChart } from './charts/PieChart';
import { PieLensManager } from './charts/PieLensManager';
import { SankeyChart } from './charts/SankeyChart';
import {
  DATA_URL,
  DEFAULT_COUNTRIES,
  DEFAULT_GLOBAL_YEAR,
  DEFAULT_METRIC,
  DEFAULT_YEAR_RANGE,
  EXTRA_COLUMNS,
} from './config';
import { EmissionsDataset } from './data/EmissionsDataset';
import { AppState } from './state/AppState';
import type { YearRange } from './state/AppState';
import { CountryLensState } from './state/CountryLensState';
import { PieLensState } from './state/PieLensState';
import { ConfigPanel } from './ui/ConfigPanel';
import { InfoTip } from './ui/InfoTip';
import { LensStagePanel } from './ui/LensStagePanel';
import { PieLensPanel } from './ui/PieLensPanel';
import { SankeyLensPanel } from './ui/SankeyLensPanel';
import { ToggleSwitch } from './ui/ToggleSwitch';

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
    const pieLens = new PieLensState();
    const lensState = new CountryLensState();

    this.render(dataset, state, pieLens, lensState, bounds);
  }

  private render(
    dataset: EmissionsDataset,
    state: AppState,
    pieLens: PieLensState,
    lensState: CountryLensState,
    bounds: YearRange,
  ): void {
    this.root.innerHTML = '';
    this.root.className = 'app';

    const sidebar = document.createElement('aside');
    sidebar.className = 'app__sidebar';
    const main = document.createElement('main');
    main.className = 'app__main';
    this.root.append(sidebar, main);

    this.buildLucToggle(sidebar, state);
    this.buildPerCapitaToggle(sidebar, state);
    new ConfigPanel(sidebar, dataset, state, bounds);
    new LensStagePanel(sidebar, lensState);
    const sankeyLensPanel = new SankeyLensPanel(sidebar);
    const charts = new ChartArea(main, dataset, state, DEFAULT_METRIC, lensState);
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
    window.addEventListener('resize', syncView);
    syncView();
  }

  private buildLucToggle(sidebar: HTMLElement, state: AppState): void {
    const panel = document.createElement('div');
    panel.className = 'luc-toggle-panel';

    const labelEl = document.createElement('span');
    labelEl.className = 'luc-toggle-panel__label';
    labelEl.textContent = 'Land use change';
    panel.appendChild(labelEl);

    const toggle = new ToggleSwitch(panel, true);
    toggle.set({ checked: true, disabled: false, label: 'Included' });

    new InfoTip(
      panel,
      'Land use change (LUC) CO₂ captures emissions from deforestation and land conversion — and can be negative when forests grow back. Excluding it shows all emissions exluding LUC, which often reveals cleaner long-term trends obscured by LUC volatility.',
      'Land use change explanation',
    );

    toggle.onChange(() => {
      const included = toggle.checked();
      toggle.set({ checked: included, disabled: false, label: included ? 'Included' : 'Excluded' });
      state.setIncludeLandUseChange(included);
    });

    sidebar.appendChild(panel);
  }

  private buildPerCapitaToggle(sidebar: HTMLElement, state: AppState): void {
    const panel = document.createElement('div');
    panel.className = 'percapita-toggle-panel';

    const labelEl = document.createElement('span');
    labelEl.className = 'percapita-toggle-panel__label';
    labelEl.textContent = 'Per capita';
    panel.appendChild(labelEl);

    const toggle = new ToggleSwitch(panel, true);
    toggle.set({ checked: false, disabled: false, label: 'Absolute' });

    toggle.onChange(() => {
      const perCapita = toggle.checked();
      toggle.set({ checked: perCapita, disabled: false, label: perCapita ? 'Per capita' : 'Absolute' });
      state.setMetricMode(perCapita ? 'per-capita' : 'absolute');
    });

    sidebar.appendChild(panel);
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
