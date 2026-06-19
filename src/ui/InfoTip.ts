import { INFO_ICON } from './icons';

/** A small info icon that reveals an explanatory bubble on hover/focus.
 *  The bubble is fixed-positioned on body, so a scroll container never clips it. */
export class InfoTip {
  readonly icon: HTMLButtonElement;
  private readonly bubble: HTMLDivElement;

  constructor(parent: HTMLElement, text: string, ariaLabel = 'How to use the lens') {
    this.icon = document.createElement('button');
    this.icon.type = 'button';
    this.icon.className = 'info-tip';
    this.icon.setAttribute('aria-label', ariaLabel);
    this.icon.innerHTML = INFO_ICON;

    this.bubble = document.createElement('div');
    this.bubble.className = 'info-tip__bubble info-tip__bubble--hidden';
    this.bubble.textContent = text;

    for (const ev of ['pointerenter', 'focus']) this.icon.addEventListener(ev, () => this.show());
    for (const ev of ['pointerleave', 'blur']) this.icon.addEventListener(ev, () => this.hide());

    parent.appendChild(this.icon);
    document.body.appendChild(this.bubble);
  }

  /** Reveal the bubble just below the icon, clamped inside the viewport. */
  private show(): void {
    this.bubble.classList.remove('info-tip__bubble--hidden');
    const box = this.icon.getBoundingClientRect();
    const left = Math.min(box.left, window.innerWidth - this.bubble.offsetWidth - 8);
    this.bubble.style.top = `${box.bottom + 8}px`;
    this.bubble.style.left = `${Math.max(8, left)}px`;
  }

  private hide(): void {
    this.bubble.classList.add('info-tip__bubble--hidden');
  }
}
