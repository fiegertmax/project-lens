import type { LensState } from '../state/LensState';
import { createLensDragSweeper } from './lens-drag-sweeper';

/** Drag the lens handle onto charts to lens countries: drop on one, or hold
 *  Shift and drag across several to lens each in turn. Complements the header +/−. */
export class LensDragController {
  private readonly lens: LensState;

  constructor(handle: HTMLElement, lens: LensState) {
    this.lens = lens;
    createLensDragSweeper<HTMLElement>(handle, {
      resolveTarget: (x, y) => chartAt(x, y),
      onHover: (target, previous) => {
        previous?.classList.remove('single-country-chart--drop');
        target?.classList.add('single-country-chart--drop');
      },
      onDrop: (target, { shift }) => {
        if (!shift) this.lensCountry(target);
      },
      onSweep: (target) => this.lensCountry(target),
    });
  }

  /** Lens a country once; arming the lens first if needed. Never un-lenses. */
  private lensCountry(chart: HTMLElement | null): void {
    const country = chart?.dataset.country;
    if (!country || this.lens.isTarget(country)) return;
    if (this.lens.currentPhase() !== 'active') this.lens.apply();
    this.lens.toggleTarget(country);
  }
}

/** The single-country chart element under a viewport point, or null. Ghost is click-through. */
function chartAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>('.single-country-chart[data-country]') ?? null;
}
