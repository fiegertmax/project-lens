import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AppState, YearRange } from '../state/AppState';
import { Collapsible } from './Collapsible';
import { CountrySelector } from './CountrySelector';
import { YearRangeSlider } from './YearRangeSlider';

/** Minimizable panel holding the (also minimizable) configuration controls. */
export class ConfigPanel {
  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    yearBounds: YearRange,
  ) {
    const panel = new Collapsible(parent, 'Configuration', 'config-panel');

    const timeSpan = new Collapsible(panel.body, 'Time span', 'config-section');
    new YearRangeSlider(timeSpan.body, state, yearBounds);

    const countries = new Collapsible(panel.body, 'Countries', 'config-section');
    new CountrySelector(countries.body, dataset.countries(), state);
  }
}
