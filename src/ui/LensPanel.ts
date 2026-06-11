import { LENS_WIDTH } from '../config';
import { LENS_EFFECTS } from '../lens/effects';
import type { LensCombineMode, LensState } from '../state/LensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { InfoTip } from './InfoTip';
import { LensDragController } from './LensDragController';
import { ToggleSwitch } from './ToggleSwitch';

/** Combine modes shown as switches, with their noun for the left-panel labels. */
const COMBINE_TOGGLES: { mode: Exclude<LensCombineMode, 'off'>; noun: string }[] = [
  { mode: 'compare', noun: 'Comparison' },
  { mode: 'accumulate', noun: 'Accumulation' },
  { mode: 'mean', noun: 'Mean' },
];

const STATUS: Record<string, string> = {
  idle: 'Configure the lens, then drag it onto a chart — or click it to arm it.',
  active:
    'Drag the lens onto charts (hold Shift for several), or click + beside a country. Drag the band; Ctrl/⌘ + scroll to resize.',
};

/** Shown in the info-icon tooltip beside the lens. */
const LENS_HELP =
  'Arm the lens, then pick countries to inspect:\n' +
  '• Click + next to a country, or\n' +
  '• Drag the lens onto a chart and release.\n' +
  'Hold Shift while dragging to lens several charts at once.\n' +
  'Drag the band to move it; Ctrl/⌘ + scroll to resize it.';

/** Second config panel: configure, start, and tear down the ChronoLens. */
export class LensPanel {
  /** Root element, used by the app to hide the panel for visualizations without a lens. */
  readonly root: HTMLDivElement;
  private readonly state: LensState;
  private readonly widthSlider: HTMLInputElement;
  private readonly widthLabel: HTMLSpanElement;
  private readonly applyWrap: HTMLDivElement;
  private readonly removeBtn: HTMLButtonElement;
  private readonly combineSwitches: ToggleSwitch[];
  private readonly status: HTMLParagraphElement;

  constructor(parent: HTMLElement, state: LensState) {
    this.state = state;
    const panel = new Collapsible(parent, 'Lens', 'lens-panel');
    this.root = panel.root;

    this.buildEffectSelector(panel.body);
    [this.widthSlider, this.widthLabel] = this.buildWidthControl(panel.body);
    [this.applyWrap, this.removeBtn] = this.buildActions(panel.body);
    this.combineSwitches = this.buildCombineToggles(panel.body);
    this.status = this.buildStatus(panel.body);

    state.subscribe(() => this.sync());
    this.sync();
  }

  /** Exclusive compare / accumulate / mean switches sharing the lens scale. */
  private buildCombineToggles(parent: HTMLElement): ToggleSwitch[] {
    const group = document.createElement('div');
    group.className = 'lens-panel__combine';
    parent.appendChild(group);
    return COMBINE_TOGGLES.map(({ mode }) => {
      const sw = new ToggleSwitch(group);
      sw.onChange(() => this.state.toggleMode(mode));
      return sw;
    });
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

  /** Lens icon (click to arm, drag onto charts to lens) with a corner info tip,
   *  paired with the Remove button. */
  private buildActions(parent: HTMLElement): [HTMLDivElement, HTMLButtonElement] {
    const wrap = document.createElement('div');
    wrap.className = 'lens-panel__actions';

    const applyWrap = document.createElement('div');
    applyWrap.className = 'lens-panel__apply';

    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'lens-panel__lens-icon';
    apply.title = 'Apply lens — click, or drag onto a chart';
    apply.innerHTML = LENS_ICON;
    apply.addEventListener('click', () => this.state.apply());

    applyWrap.appendChild(apply);
    new InfoTip(applyWrap, LENS_HELP);
    new LensDragController(apply, this.state);
    wrap.appendChild(applyWrap);

    const remove = this.button(wrap, 'Remove Lens', () => this.state.reset());
    parent.appendChild(wrap);
    return [applyWrap, remove];
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

    // The lens icon stays available in both phases — it is also the drag source.
    this.applyWrap.classList.toggle('lens-panel__apply--active', phase === 'active');
    this.show(this.removeBtn, phase === 'active');
    this.syncCombine(phase);

    const count = this.state.targetCount();
    const suffix = phase === 'active' && count > 0 ? ` — ${count} lensed` : '';
    this.status.textContent = STATUS[phase] + suffix;
  }

  /** Combine modes need an active lens on at least two countries; sum needs a non-% effect. */
  private syncCombine(phase: string): void {
    const mode = this.state.combineMode();
    const inactive = phase !== 'active' || this.state.targetCount() < 2;
    const accumulable = LENS_EFFECTS[this.state.currentEffect()].accumulable;
    COMBINE_TOGGLES.forEach(({ mode: m, noun }, i) => {
      const checked = mode === m;
      const disabled = inactive || (m === 'accumulate' && !accumulable);
      this.combineSwitches[i].set({
        checked,
        disabled,
        label: `${noun} ${checked ? 'enabled' : 'disabled'}`,
      });
    });
  }

  private show(element: HTMLElement, visible: boolean): void {
    element.classList.toggle('lens-panel__button--hidden', !visible);
  }
}
