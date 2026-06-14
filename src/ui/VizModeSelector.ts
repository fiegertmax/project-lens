import type { AppState, GlobalVizMode } from '../state/AppState';

const OPTIONS: { value: GlobalVizMode; label: string }[] = [
  { value: 'sankey', label: 'Sankey' },
  { value: 'pie', label: 'Pie' },
];

/** Native radio pair (Sankey | Pie) for picking the global tab's sub-visualization. */
export class VizModeSelector {
  constructor(parent: HTMLElement, state: AppState) {
    const wrap = document.createElement('div');
    wrap.className = 'viz-mode-selector';

    const inputs: HTMLInputElement[] = [];
    for (const { value, label } of OPTIONS) {
      const item = document.createElement('label');
      item.className = 'viz-mode-selector__option';

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'global-viz-mode';
      input.value = value;
      input.checked = state.globalVizMode() === value;
      input.addEventListener('change', () => {
        if (input.checked) state.setGlobalVizMode(value);
      });

      const text = document.createElement('span');
      text.textContent = label;

      item.append(input, text);
      wrap.appendChild(item);
      inputs.push(input);
    }

    parent.appendChild(wrap);

    state.subscribe(() => {
      for (const input of inputs) input.checked = input.value === state.globalVizMode();
    });
  }
}
