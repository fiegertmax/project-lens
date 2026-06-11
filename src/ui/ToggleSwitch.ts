/** State the owner pushes into a switch each sync. */
export interface ToggleState {
  checked: boolean;
  disabled: boolean;
  label: string;
}

/** A labelled pill on/off switch, reused by the lens config panels. */
export class ToggleSwitch {
  readonly root: HTMLLabelElement;
  private readonly input: HTMLInputElement;
  private readonly text: HTMLSpanElement;
  private handler: (() => void) | null = null;

  constructor(parent: HTMLElement, compact = false) {
    this.root = document.createElement('label');
    this.root.className = compact ? 'toggle-switch toggle-switch--compact' : 'toggle-switch';

    this.input = document.createElement('input');
    this.input.type = 'checkbox';
    this.input.className = 'toggle-switch__input';
    this.input.addEventListener('change', () => this.handler?.());

    const track = document.createElement('span');
    track.className = 'toggle-switch__track';

    this.text = document.createElement('span');
    this.text.className = 'toggle-switch__label';

    this.root.append(this.input, track, this.text);
    parent.appendChild(this.root);
  }

  /** Fires only on user interaction (programmatic `set` does not re-enter). */
  onChange(handler: () => void): void {
    this.handler = handler;
  }

  set({ checked, disabled, label }: ToggleState): void {
    this.input.checked = checked;
    this.input.disabled = disabled;
    this.text.textContent = label;
    this.root.classList.toggle('toggle-switch--disabled', disabled);
  }
}
