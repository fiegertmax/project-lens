import { LENS_WIDTH } from '../config';
import { LENS_EFFECTS } from '../lens/effects';
import type { LensState } from '../state/LensState';
import { Collapsible } from './Collapsible';

const STATUS: Record<string, string> = {
  idle: 'Configure the lens, then start it.',
  selecting: 'Click charts to select countries of interest.',
  active: 'Drag the lens across the charts. Ctrl/⌘ + scroll to resize.',
};

/** Second config panel: configure, start, and tear down the ChronoLens. */
export class LensPanel {
  private readonly state: LensState;
  private readonly widthSlider: HTMLInputElement;
  private readonly widthLabel: HTMLSpanElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly activateBtn: HTMLButtonElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly compareBtn: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;

  constructor(parent: HTMLElement, state: LensState) {
    this.state = state;
    const panel = new Collapsible(parent, 'Lens', 'lens-panel');

    this.buildEffectSelector(panel.body);
    [this.widthSlider, this.widthLabel] = this.buildWidthControl(panel.body);
    [this.startBtn, this.activateBtn, this.removeBtn] = this.buildActions(panel.body);
    this.compareBtn = this.buildCompareToggle(panel.body);
    this.status = this.buildStatus(panel.body);

    state.subscribe(() => this.sync());
    this.sync();
  }

  /** Toggle sharing one lens scale across countries for absolute comparison. */
  private buildCompareToggle(parent: HTMLElement): HTMLButtonElement {
    const wrap = document.createElement('div');
    wrap.className = 'lens-panel__compare';
    const button = this.button(wrap, 'Enable comparison', () =>
      this.state.toggleComparison(),
    );
    parent.appendChild(wrap);
    return button;
  }

  private buildEffectSelector(parent: HTMLElement): void {
    const group = document.createElement('div');
    group.className = 'lens-panel__effects';
    for (const effect of Object.values(LENS_EFFECTS)) {
      const label = document.createElement('label');
      label.className = 'lens-panel__effect';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'lens-effect';
      radio.value = effect.key;
      radio.checked = this.state.currentEffect() === effect.key;
      radio.addEventListener('change', () => this.state.setEffect(effect.key));

      const text = document.createElement('span');
      text.textContent = effect.label;
      label.append(radio, text);
      group.appendChild(label);
    }
    parent.appendChild(group);
  }

  private buildWidthControl(parent: HTMLElement): [HTMLInputElement, HTMLSpanElement] {
    const wrap = document.createElement('div');
    wrap.className = 'lens-panel__width';

    const label = document.createElement('span');
    label.className = 'lens-panel__width-label';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(LENS_WIDTH.min);
    slider.max = String(LENS_WIDTH.max);
    slider.step = '1';
    slider.value = String(this.state.currentWidth());
    slider.addEventListener('input', () =>
      this.state.setWidth(Number(slider.value)),
    );

    wrap.append(label, slider);
    parent.appendChild(wrap);
    return [slider, label];
  }

  private buildActions(parent: HTMLElement): [
    HTMLButtonElement,
    HTMLButtonElement,
    HTMLButtonElement,
  ] {
    const wrap = document.createElement('div');
    wrap.className = 'lens-panel__actions';
    const start = this.button(wrap, 'Start lens', () => this.state.start());
    const activate = this.button(wrap, 'Activate', () => this.state.activate());
    const remove = this.button(wrap, 'Remove', () => this.state.reset());
    parent.appendChild(wrap);
    return [start, activate, remove];
  }

  private button(
    parent: HTMLElement,
    text: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lens-panel__button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  }

  private buildStatus(parent: HTMLElement): HTMLParagraphElement {
    const status = document.createElement('p');
    status.className = 'lens-panel__status';
    parent.appendChild(status);
    return status;
  }

  /** Reflect the current phase: button visibility, width readout, status text. */
  private sync(): void {
    const phase = this.state.currentPhase();
    const width = this.state.currentWidth();
    this.widthSlider.value = String(width);
    this.widthLabel.textContent = `Width: ${width} yrs`;

    this.show(this.startBtn, phase === 'idle');
    this.show(this.activateBtn, phase === 'selecting');
    this.show(this.removeBtn, phase !== 'idle');
    this.activateBtn.disabled = this.state.targetCount() === 0;
    this.syncCompare(phase);

    const count = this.state.targetCount();
    const suffix = phase === 'selecting' ? ` — ${count} selected` : '';
    this.status.textContent = STATUS[phase] + suffix;
  }

  /** Comparison needs an active lens on at least two countries. */
  private syncCompare(phase: string): void {
    const enabled = this.state.comparisonEnabled();
    this.compareBtn.disabled = phase !== 'active' || this.state.targetCount() < 2;
    this.compareBtn.classList.toggle('lens-panel__button--active', enabled);
    this.compareBtn.setAttribute('aria-pressed', String(enabled));
    this.compareBtn.textContent = enabled ? 'Disable comparison' : 'Enable comparison';
  }

  private show(element: HTMLElement, visible: boolean): void {
    element.classList.toggle('lens-panel__button--hidden', !visible);
  }
}
