import type { AppState, YearRange } from '../state/AppState';

/** Dual-handle range over years; the only writer of the year range to state. */
export class YearRangeSlider {
  private readonly minInput: HTMLInputElement;
  private readonly maxInput: HTMLInputElement;
  private readonly fill: HTMLDivElement;
  private readonly readout: HTMLSpanElement;
  private readonly state: AppState;
  private readonly bounds: YearRange;

  constructor(parent: HTMLElement, state: AppState, bounds: YearRange) {
    this.state = state;
    this.bounds = bounds;
    const [from, to] = state.yearRange();
    const container = document.createElement('div');
    container.className = 'year-slider';

    this.readout = document.createElement('span');
    this.readout.className = 'year-slider__readout';

    const track = document.createElement('div');
    track.className = 'year-slider__track';
    this.fill = document.createElement('div');
    this.fill.className = 'year-slider__fill';
    this.minInput = this.makeInput('min', from);
    this.maxInput = this.makeInput('max', to);
    track.append(this.fill, this.minInput, this.maxInput);

    container.append(this.readout, track);
    parent.appendChild(container);

    this.minInput.addEventListener('input', () => this.onInput());
    this.maxInput.addEventListener('input', () => this.onInput());
    this.sync();
  }

  private makeInput(kind: 'min' | 'max', value: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'range';
    input.className = `year-slider__input year-slider__input--${kind}`;
    input.min = String(this.bounds[0]);
    input.max = String(this.bounds[1]);
    input.step = '1';
    input.value = String(value);
    return input;
  }

  /** Keep handles from crossing, then push the new range to state. */
  private onInput(): void {
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

  private sync(): void {
    const [from, to] = this.state.yearRange();
    this.readout.textContent = `${from} – ${to}`;
    const [lo, hi] = this.bounds;
    const span = hi - lo || 1;
    this.fill.style.left = `${((from - lo) / span) * 100}%`;
    this.fill.style.right = `${((hi - to) / span) * 100}%`;
  }
}
