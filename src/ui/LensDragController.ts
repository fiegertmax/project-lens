import type { LensState } from '../state/LensState';
import { LENS_ICON } from './icons';

/** Pointer travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/** Drag the lens handle onto charts to lens countries: drop on one, or hold
 *  Shift and drag across several to lens each in turn. Complements the header +/−. */
export class LensDragController {
  private readonly lens: LensState;
  private origin: { x: number; y: number } | null = null;
  private dragging = false;
  private ghost: HTMLElement | null = null;
  private hovered: HTMLElement | null = null;

  constructor(handle: HTMLElement, lens: LensState) {
    this.lens = lens;
    handle.addEventListener('pointerdown', (e) => this.onDown(e));
  }

  private onDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    // No preventDefault: let the button's click fire for keyboard/mouse arming.
    // Text selection during a sweep is suppressed via body.lens-dragging.
    this.origin = { x: event.clientX, y: event.clientY };
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private onMove = (event: PointerEvent): void => {
    if (!this.origin) return;
    if (!this.dragging) {
      const moved = Math.hypot(event.clientX - this.origin.x, event.clientY - this.origin.y);
      if (moved < DRAG_THRESHOLD) return;
      this.begin();
    }
    this.moveGhost(event);
    const chart = chartAt(event.clientX, event.clientY);
    this.hover(chart);
    if (event.shiftKey) this.lensCountry(chart); // additive while sweeping
  };

  private onUp = (event: PointerEvent): void => {
    if (this.dragging && !event.shiftKey) this.lensCountry(chartAt(event.clientX, event.clientY));
    this.end();
  };

  private begin(): void {
    this.dragging = true;
    this.ghost = document.createElement('div');
    this.ghost.className = 'lens-ghost';
    this.ghost.innerHTML = LENS_ICON;
    document.body.append(this.ghost);
    document.body.classList.add('lens-dragging');
  }

  /** Lens a country once; arming the lens first if needed. Never un-lenses. */
  private lensCountry(chart: HTMLElement | null): void {
    const country = chart?.dataset.country;
    if (!country || this.lens.isTarget(country)) return;
    if (this.lens.currentPhase() !== 'active') this.lens.apply();
    this.lens.toggleTarget(country);
  }

  private hover(chart: HTMLElement | null): void {
    if (this.hovered === chart) return;
    this.hovered?.classList.remove('line-chart--drop');
    chart?.classList.add('line-chart--drop');
    this.hovered = chart;
  }

  private moveGhost(event: PointerEvent): void {
    if (!this.ghost) return;
    this.ghost.style.left = `${event.clientX}px`;
    this.ghost.style.top = `${event.clientY}px`;
  }

  private end(): void {
    this.hover(null);
    this.ghost?.remove();
    this.ghost = null;
    this.dragging = false;
    this.origin = null;
    document.body.classList.remove('lens-dragging');
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }
}

/** The chart element under a viewport point, or null. Ghost is click-through. */
function chartAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>('.line-chart') ?? null;
}
