import type { PieLensManager } from '../charts/PieLensManager';
import type { PieLensState } from '../state/PieLensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { InfoTip } from './InfoTip';
import { PieLensDragController } from './PieLensDragController';

const LENS_HELP =
  'Drag the lens onto a slice:\n' +
  '• onto a continent → see its countries as a pie\n' +
  '• onto a country (in any lens) → see its CO₂ source mix\n' +
  'Hold Shift while dragging to lens several slices at once.\n' +
  'Drag any open lens by its title to move it; drop it on a same-level slice to retarget.\n' +
  'Use × on a lens to close just that one.';

/** Sidebar panel for the pie-chart drill-down lens system.
 *  Shows: draggable lens icon + help tip + "Deactivate all lenses" button. */
export class PieLensPanel {
  readonly root: HTMLDivElement;
  private readonly state: PieLensState;
  private readonly removeBtn: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;

  constructor(parent: HTMLElement, state: PieLensState, manager: PieLensManager, overlay: HTMLElement) {
    this.state = state;
    const panel = new Collapsible(parent, 'Lens', 'lens-panel');
    this.root = panel.root;

    const actions = document.createElement('div');
    actions.className = 'lens-panel__actions';
    panel.body.appendChild(actions);

    const applyWrap = document.createElement('div');
    applyWrap.className = 'lens-panel__apply';

    const icon = document.createElement('button');
    icon.type = 'button';
    icon.className = 'lens-panel__lens-icon';
    icon.title = 'Drag onto a slice to open a drill-down pie';
    icon.innerHTML = LENS_ICON;
    icon.addEventListener('click', (e) => e.preventDefault());

    applyWrap.appendChild(icon);
    new InfoTip(applyWrap, LENS_HELP);
    new PieLensDragController(icon, state, manager, overlay);
    actions.appendChild(applyWrap);

    this.removeBtn = document.createElement('button');
    this.removeBtn.type = 'button';
    this.removeBtn.className = 'lens-panel__button';
    this.removeBtn.textContent = 'Deactivate all lenses';
    this.removeBtn.addEventListener('click', () => this.state.clear());
    actions.appendChild(this.removeBtn);

    this.status = document.createElement('p');
    this.status.className = 'lens-panel__status';
    panel.body.appendChild(this.status);

    state.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const count = this.state.count();
    this.removeBtn.classList.toggle('lens-panel__button--hidden', count === 0);
    this.status.textContent = count === 0
      ? 'Drag the lens onto a slice to drill down. Shift-drag to open several.'
      : `${count} lens${count === 1 ? '' : 'es'} open — drag the title to move; drop on another slice to retarget.`;
  }
}
