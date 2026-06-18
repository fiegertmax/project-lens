import { LENS_WIDTH } from '../config';
import type { LensState } from '../state/LensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { LensDragController } from './LensDragController';

/** Sidebar panel for configuring and deploying the ChronoLens. */
export class LensPanel {
  readonly root: HTMLDivElement;
  private readonly state: LensState;
  private readonly widthSlider: HTMLInputElement;
  private readonly widthLabel: HTMLSpanElement;
  private readonly applyWrap: HTMLDivElement;
  private readonly removeBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, state: LensState) {
    this.state = state;
    const panel = new Collapsible(parent, 'Lens', 'lens-panel');
    this.root = panel.root;

    [this.widthSlider, this.widthLabel] = this.buildWidthControl(panel.body);
    [this.applyWrap, this.removeBtn] = this.buildActions(panel.body);

    state.subscribe(() => this.sync());
    this.sync();
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
    slider.addEventListener('input', () => this.state.setWidth(Number(slider.value)));

    wrap.append(label, slider);
    parent.appendChild(wrap);
    return [slider, label];
  }

  /** Draggable lens icon (also click to arm) paired with a Remove button. */
  private buildActions(parent: HTMLElement): [HTMLDivElement, HTMLButtonElement] {
    const wrap = document.createElement('div');
    wrap.className = 'lens-panel__actions';

    const applyWrap = document.createElement('div');
    applyWrap.className = 'lens-panel__apply';

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'lens-panel__lens-icon';
    apply.title = 'Drag onto a country chart to apply lens (hold Shift for multiple)';
    apply.innerHTML = LENS_ICON;
    apply.addEventListener('click', () => this.state.apply());

    applyWrap.appendChild(apply);
    new LensDragController(apply, this.state);
    wrap.appendChild(applyWrap);

    const remove = this.button(wrap, 'Remove Lens', () => this.state.reset());
    parent.appendChild(wrap);
    return [applyWrap, remove];
  }

  private button(parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lens-panel__button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    parent.appendChild(button);
    return button;
  }

  private sync(): void {
    const phase = this.state.currentPhase();
    const width = this.state.currentWidth();
    this.widthSlider.value = String(width);
    this.widthLabel.textContent = `Width: ${width} yrs`;
    this.applyWrap.classList.toggle('lens-panel__apply--active', phase === 'active');
    this.removeBtn.classList.toggle('lens-panel__button--hidden', phase !== 'active');
  }
}
