import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AppState, BaseVisualizationTab, YearRange } from '../state/AppState';
import { Collapsible } from './Collapsible';
import { ContinentFocusSelector } from './ContinentFocusSelector';
import { CountrySelector } from './CountrySelector';
import { Tabs } from './Tabs';
import { YearRangeSlider } from './YearRangeSlider';
import { YearSelector } from './YearSelector';

/** Minimizable panel holding the (also minimizable) configuration controls,
 *  one tab per base visualization. */
export class ConfigPanel {
  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    yearBounds: YearRange,
  ) {
    const panel = new Collapsible(parent, 'Base Visualization', 'config-panel');

    new Tabs(
      panel.body,
      [
        {
          id: 'by-country',
          label: 'Emissions by Country',
          render: (body) => {
            const timeSpan = new Collapsible(body, 'Time span', 'config-section');
            new YearRangeSlider(timeSpan.body, state, yearBounds);
            const countries = new Collapsible(body, 'Countries', 'config-section');
            new CountrySelector(countries.body, dataset.countries(), state);
          },
        },
        {
          id: 'global',
          label: 'Global emissions',
          render: (body) => {
            new YearSelector(body, state, yearBounds);
            new ContinentFocusSelector(body, state);
          },
        },
      ],
      state.activeTab(),
      (id) => state.setActiveTab(id as BaseVisualizationTab),
    );
  }
}
