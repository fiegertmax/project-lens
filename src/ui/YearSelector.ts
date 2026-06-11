import type { AppState, YearRange } from '../state/AppState';

/** Single-year control: a number field and a slider, kept in sync with state. */
export class YearSelector {
  private readonly field: HTMLInputElement;
  private readonly input: HTMLInputElement;
  private readonly fill: HTMLDivElement;
  private readonly state: AppState;
  private readonly bounds: YearRange;

  constructor(parent: HTMLElement, state: AppState, bounds: YearRange) {
    this.state = state;
    this.bounds = bounds;
    const year = state.globalYear();

    const container = document.createElement('div');
    container.className = 'year-slider';

    const readout = document.createElement('div');
    readout.className = 'year-slider__readout';
    this.field = this.makeField(year);
    readout.append(this.field);

    const track = document.createElement('div');
    track.className = 'year-slider__track';
    this.fill = document.createElement('div');
    this.fill.className = 'year-slider__fill';
    this.input = this.makeRangeInput(year);
    track.append(this.fill, this.input);

    container.append(readout, track);
    parent.appendChild(container);

    this.input.addEventListener('input', () => this.onSliderInput());
    this.field.addEventListener('change', () => this.onFieldChange());
    this.sync();
  }

  private makeRangeInput(value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'year-slider__input';
    input.min = String(this.bounds[0]);
    input.max = String(this.bounds[1]);
    input.step = '1';
    input.value = String(value);
    return input;
  }

  private makeField(value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'year-slider__field';
    input.min = String(this.bounds[0]);
    input.max = String(this.bounds[1]);
    input.step = '1';
    input.value = String(value);
    input.setAttribute('aria-label', 'Year');
    return input;
  }

  private onSliderInput(): void {
    this.state.setGlobalYear(Number(this.input.value));
    this.sync();
  }

  private onFieldChange(): void {
    const [lo, hi] = this.bounds;
    const year = this.clamp(Number(this.field.value) || lo, lo, hi);
    this.state.setGlobalYear(year);
    this.sync();
  }

  private clamp(value: number, lo: number, hi: number): number {
    return Math.min(Math.max(value, lo), hi);
  }

  private sync(): void {
    const year = this.state.globalYear();
    this.field.value = String(year);
    this.input.value = String(year);
    const [lo, hi] = this.bounds;
    const span = hi - lo || 1;
    const pct = ((year - lo) / span) * 100;
    this.fill.style.left = '0%';
    this.fill.style.right = `${100 - pct}%`;
  }
}
