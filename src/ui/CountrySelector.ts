import type { AppState } from '../state/AppState';

interface Row {
  element: HTMLLabelElement;
  country: string;
}

/** Searchable, alphabetically sorted checkbox list of selectable entities. */
export class CountrySelector {
  private readonly rows: Row[];
  private readonly state: AppState;

  constructor(parent: HTMLElement, countries: string[], state: AppState) {
    this.state = state;
    const container = document.createElement('div');
    container.className = 'country-selector';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'country-selector__search';
    search.placeholder = 'Search countries…';
    search.addEventListener('input', () => this.filter(search.value));

    const list = document.createElement('div');
    list.className = 'country-selector__list';
    this.rows = countries.map((country) => this.makeRow(list, country));

    container.append(search, list);
    parent.appendChild(container);
  }

  private makeRow(list: HTMLElement, country: string): Row {
    const label = document.createElement('label');
    label.className = 'country-selector__item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = this.state.isSelected(country);
    checkbox.addEventListener('change', () => this.state.toggleCountry(country));

    const name = document.createElement('span');
    name.textContent = country;

    label.append(checkbox, name);
    list.appendChild(label);
    return { element: label, country };
  }

  private filter(query: string): void {
    const needle = query.trim().toLowerCase();
    for (const { element, country } of this.rows) {
      const visible = country.toLowerCase().includes(needle);
      element.classList.toggle('country-selector__item--hidden', !visible);
    }
  }
}
