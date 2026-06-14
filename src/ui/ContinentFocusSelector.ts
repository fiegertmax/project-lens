import { FOCUSABLE_CONTINENTS } from '../data/continents';
import type { AppState } from '../state/AppState';
import { ToggleSwitch } from './ToggleSwitch';

/** "Set focus" checkbox + continent dropdown: zooms the Sankey into one continent. */
export class ContinentFocusSelector {
  private readonly toggle: ToggleSwitch;
  private readonly select: HTMLSelectElement;
  private readonly state: AppState;

  constructor(parent: HTMLElement, state: AppState) {
    this.state = state;

    const container = document.createElement('div');
    container.className = 'focus-selector';

    this.toggle = new ToggleSwitch(container);
    this.toggle.onChange(() => this.onToggleChange());

    this.select = this.makeSelect();
    container.append(this.select);

    parent.appendChild(container);

    this.select.addEventListener('change', () => this.onSelectChange());
    this.sync();
  }

  private makeSelect(): HTMLSelectElement {
    const select = document.createElement('select');
    select.className = 'focus-selector__select';
    select.setAttribute('aria-label', 'Focus continent');
    for (const continent of FOCUSABLE_CONTINENTS) {
      const option = document.createElement('option');
      option.value = continent;
      option.textContent = continent;
      select.append(option);
    }
    return select;
  }

  private onToggleChange(): void {
    const continent = this.toggle.checked()
      ? (this.state.focusedContinent() ?? this.select.value)
      : null;
    this.state.setFocusedContinent(continent);
    this.sync();
  }

  private onSelectChange(): void {
    this.state.setFocusedContinent(this.select.value);
    this.sync();
  }

  private sync(): void {
    const focus = this.state.focusedContinent();
    this.toggle.set({ checked: focus !== null, disabled: false, label: 'Set focus' });
    this.select.value = focus ?? this.select.value;
    this.select.classList.toggle('focus-selector__select--hidden', focus === null);
  }
}
