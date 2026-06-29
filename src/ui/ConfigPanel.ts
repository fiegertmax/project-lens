import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AppState, YearRange } from '../state/AppState';
import { Collapsible } from './Collapsible';
import { CountrySelector } from './CountrySelector';
import { InfoTip } from './InfoTip';
import { ToggleSwitch } from './ToggleSwitch';
import { WorldMapModal } from './WorldMapModal';
import { YearRangeSlider } from './YearRangeSlider';
import { GLOBE_ICON } from './icons';

/** Minimizable panel holding the (also minimizable) configuration controls. */
export class ConfigPanel {
  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    yearBounds: YearRange,
  ) {
    const panel = new Collapsible(parent, 'Base Visualization', 'config-panel');
    const body = panel.body;

    const timeSpan = new Collapsible(body, 'Time span', 'config-section');
    new YearRangeSlider(timeSpan.body, state, yearBounds);
    const countries = new Collapsible(body, 'Countries', 'config-section');
    this.buildWorldMapButton(countries, dataset, state);
    new CountrySelector(countries.body, dataset.countries(), state);
    this.buildLucToggle(body, state);
    this.buildPerCapitaToggle(body, state);
  }

  /** Globe button in the Countries header that opens the quick-select map. */
  private buildWorldMapButton(section: Collapsible, dataset: EmissionsDataset, state: AppState): void {
    const modal = new WorldMapModal(dataset, state);

    const wrapper = document.createElement('div');
    wrapper.className = 'world-map-header-actions';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'world-map-button';
    button.setAttribute('aria-label', 'Pick countries on a world map');
    button.innerHTML = GLOBE_ICON;
    button.addEventListener('click', (e) => {
      e.stopPropagation(); // don't toggle the collapsible
      void modal.open();
    });

    const tip = new InfoTip(
      wrapper,
      'Opens an interactive world map — click any country to add or remove it from the chart.',
      'World map explanation',
    );
    tip.icon.addEventListener('click', (e) => e.stopPropagation());

    wrapper.insertBefore(button, tip.icon);
    section.appendToHeader(wrapper);
  }

  private buildLucToggle(parent: HTMLElement, state: AppState): void {
    const row = document.createElement('div');
    row.className = 'config-toggle-row';

    const label = document.createElement('span');
    label.className = 'config-toggle-row__label';
    label.textContent = 'Land use change';
    row.appendChild(label);

    const toggle = new ToggleSwitch(row, true);
    toggle.set({ checked: true, disabled: false, label: 'Included' });

    new InfoTip(
      row,
      'Land use change (LUC) CO₂ captures emissions from deforestation and land conversion — and can be negative when forests grow back. Excluding it shows all emissions excluding LUC, which often reveals cleaner long-term trends obscured by LUC volatility.',
      'Land use change explanation',
    );

    toggle.onChange(() => {
      const included = toggle.checked();
      toggle.set({ checked: included, disabled: false, label: included ? 'Included' : 'Excluded' });
      state.setIncludeLandUseChange(included);
    });

    parent.appendChild(row);
  }

  private buildPerCapitaToggle(parent: HTMLElement, state: AppState): void {
    const row = document.createElement('div');
    row.className = 'config-toggle-row';

    const label = document.createElement('span');
    label.className = 'config-toggle-row__label';
    label.textContent = 'Per capita';
    row.appendChild(label);

    const toggle = new ToggleSwitch(row, true);
    toggle.set({ checked: true, disabled: false, label: 'Per capita' });

    toggle.onChange(() => {
      const perCapita = toggle.checked();
      toggle.set({ checked: perCapita, disabled: false, label: perCapita ? 'Per capita' : 'Absolute' });
      state.setMetricMode(perCapita ? 'per-capita' : 'absolute');
    });

    // Keep toggle in sync when metric mode changes programmatically (e.g. via slope chart click)
    state.subscribe(() => {
      const perCapita = state.metricMode() === 'per-capita';
      if (toggle.checked() !== perCapita) {
        toggle.set({ checked: perCapita, disabled: false, label: perCapita ? 'Per capita' : 'Absolute' });
      }
    });

    parent.appendChild(row);
  }
}
