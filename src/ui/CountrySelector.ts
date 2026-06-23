import type { AppState } from '../state/AppState';

interface Row {
  element: HTMLLabelElement;
  country: string;
}

/** Searchable, alphabetically sorted checkbox list of selectable entities. */
export class CountrySelector {
  private readonly rows: Row[];
  private readonly state: AppState;
  private readonly selectedList: HTMLElement;
  private searchQuery = '';

  constructor(parent: HTMLElement, countries: string[], state: AppState) {
    this.state = state;
    const container = document.createElement('div');
    container.className = 'country-selector';

    this.selectedList = document.createElement('div');
    this.selectedList.className = 'country-selector__selected';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'country-selector__search';
    search.placeholder = 'Search countries…';
    search.addEventListener('input', () => {
      this.searchQuery = search.value;
      this.applyFilter();
    });

    const list = document.createElement('div');
    list.className = 'country-selector__list';
    this.rows = countries.map((country) => this.makeRow(list, country));

    container.append(this.selectedList, search, list);
    parent.appendChild(container);

    state.subscribe(() => this.refresh());
    this.refresh();
  }

  private makeRow(list: HTMLElement, country: string): Row {
    const label = document.createElement('label');
    label.className = 'country-selector__item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    checkbox.addEventListener('change', () => this.state.toggleCountry(country));

    const name = document.createElement('span');
    name.textContent = country;

    label.append(checkbox, name);
    list.appendChild(label);
    return { element: label, country };
  }

  private refresh(): void {
    // Rebuild selected list
    this.selectedList.innerHTML = '';
    const selected = this.state.selectedCountries().sort();
    for (const country of selected) {
      this.selectedList.appendChild(this.makeSelectedRow(country));
    }
    this.selectedList.classList.toggle('country-selector__selected--empty', selected.length === 0);

    // Sync checkboxes and visibility in the main list
    this.applyFilter();
  }

  private makeSelectedRow(country: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'country-selector__item country-selector__item--selected';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => this.state.toggleCountry(country));

    const name = document.createElement('span');
    name.textContent = country;

    label.append(checkbox, name);
    return label;
  }

  private applyFilter(): void {
    const needle = this.searchQuery.trim().toLowerCase();
    for (const { element, country } of this.rows) {
      const isSelected = this.state.isSelected(country);
      const matchesSearch = !needle || country.toLowerCase().includes(needle);
      element.classList.toggle('country-selector__item--hidden', isSelected || !matchesSearch);
      // Keep checkbox state in sync
      const cb = element.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb) cb.checked = false;
    }
  }
}
