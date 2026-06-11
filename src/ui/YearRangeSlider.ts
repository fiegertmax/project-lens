import type { AppState, YearRange } from '../state/AppState';

/** Dual-handle range over years; the only writer of the year range to state. */
export class YearRangeSlider {
  private readonly minInput: HTMLInputElement;
  private readonly maxInput: HTMLInputElement;
  private readonly fill: HTMLDivElement;
  private readonly fromField: HTMLInputElement;
  private readonly toField: HTMLInputElement;
  private readonly state: AppState;
  private readonly bounds: YearRange;

  constructor(parent: HTMLElement, state: AppState, bounds: YearRange) {
    this.state = state;
    this.bounds = bounds;
    const [from, to] = state.yearRange();
    const container = document.createElement('div');
    container.className = 'year-slider';

    const readout = document.createElement('div');
    readout.className = 'year-slider__readout';
    this.fromField = this.makeField('From', from);
    this.toField = this.makeField('To', to);
    const separator = document.createElement('span');
    separator.className = 'year-slider__separator';
    separator.textContent = '–';
    readout.append(this.fromField, separator, this.toField);

    const track = document.createElement('div');
    track.className = 'year-slider__track';
    this.fill = document.createElement('div');
    this.fill.className = 'year-slider__fill';
    this.minInput = this.makeRangeInput('min', from);
    this.maxInput = this.makeRangeInput('max', to);
    track.append(this.fill, this.minInput, this.maxInput);

    container.append(readout, track);
    parent.appendChild(container);

    this.minInput.addEventListener('input', () => this.onSliderInput());
    this.maxInput.addEventListener('input', () => this.onSliderInput());
    this.fromField.addEventListener('change', () => this.onFieldChange('from'));
    this.toField.addEventListener('change', () => this.onFieldChange('to'));
    this.sync();
  }

  private makeRangeInput(kind: 'min' | 'max', value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.className = `year-slider__input year-slider__input--${kind}`;
    input.min = String(this.bounds[0]);
    input.max = String(this.bounds[1]);
    input.step = '1';
    input.value = String(value);
    return input;
  }

  private makeField(label: string, value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'year-slider__field';
    input.min = String(this.bounds[0]);
    input.max = String(this.bounds[1]);
    input.step = '1';
    input.value = String(value);
    input.setAttribute('aria-label', `${label} year`);
    return input;
  }

  /** Keep handles from crossing, then push the new range to state. */
  private onSliderInput(): void {
    let from = Number(this.minInput.value);
    let to = Number(this.maxInput.value);
    if (from > to) {
      [from, to] = [to, from];
      this.minInput.value = String(from);
      this.maxInput.value = String(to);
    }
    this.state.setYearRange([from, to]);
    this.sync();
  }

  /** Clamp typed values to the data bounds, keeping `from` <= `to`. */
  private onFieldChange(edited: 'from' | 'to'): void {
    const [lo, hi] = this.bounds;
    let from = this.clamp(Number(this.fromField.value) || lo, lo, hi);
    let to = this.clamp(Number(this.toField.value) || hi, lo, hi);
    if (from > to) {
      if (edited === 'from') to = from;
      else from = to;
    }
    this.state.setYearRange([from, to]);
    this.sync();
  }

  private clamp(value: number, lo: number, hi: number): number {
    return Math.min(Math.max(value, lo), hi);
  }

  private sync(): void {
    const [from, to] = this.state.yearRange();
    this.fromField.value = String(from);
    this.toField.value = String(to);
    this.minInput.value = String(from);
    this.maxInput.value = String(to);
    const [lo, hi] = this.bounds;
    const span = hi - lo || 1;
    this.fill.style.left = `${((from - lo) / span) * 100}%`;
    this.fill.style.right = `${((hi - to) / span) * 100}%`;
  }
}
