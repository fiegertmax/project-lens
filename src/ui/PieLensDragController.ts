import type { PieLensManager } from '../charts/PieLensManager';
import type { PieLensLevel, PieLensState } from '../state/PieLensState';
import { createLensDragSweeper } from './lens-drag-sweeper';

/** Drag the sidebar lens icon onto a pie slice to spawn a drill-down lens.
 *  Drop on a continent slice → country-level lens; drop on a country slice (in any
 *  active lens) → source-level lens. Hold Shift while sweeping to spawn one lens
 *  per newly-hovered slice. */
export class PieLensDragController {
  constructor(handle: HTMLElement, state: PieLensState, manager: PieLensManager, overlay: HTMLElement) {
    const spawn = (slice: SVGGElement): void => {
      const level = resolveSpawnLevel(slice);
      if (!level) return;
      const name = slice.dataset.sliceName;
      if (!name) return;
      const anchor = sliceAnchorInOverlay(slice, overlay);
      const position = manager.pickPosition(anchor);
      state.spawn(level, name, position);
    };

    createLensDragSweeper<SVGGElement>(handle, {
      resolveTarget: (x, y) => sliceUnder(x, y),
      onHover: (target, previous) => {
        previous?.classList.remove('pie-slice--drop-target');
        target?.classList.add('pie-slice--drop-target');
      },
      onDrop: (target, { shift }) => {
        if (!shift && target) spawn(target);
      },
      onSweep: (target) => spawn(target),
    });
  }
}

/** Which level of lens a drop on this slice spawns. Continent slices → 'country',
 *  country slices → 'source'. Disabled slices (e.g. bunkers, sources) return null. */
function resolveSpawnLevel(slice: SVGGElement): PieLensLevel | null {
  if (slice.dataset.sliceDisabled === 'true') return null;
  switch (slice.dataset.sliceLevel) {
    case 'continent':
      return 'country';
    case 'country':
      return 'source';
    default:
      return null;
  }
}

function sliceUnder(x: number, y: number): SVGGElement | null {
  const el = document.elementFromPoint(x, y);
  const slice = el?.closest('.pie-slice') as SVGGElement | null;
  if (!slice) return null;
  if (slice.dataset.sliceDisabled === 'true') return null;
  return slice;
}

/** Center of the slice in pixel coordinates inside the overlay container. */
function sliceAnchorInOverlay(slice: SVGGElement, overlay: HTMLElement): { x: number; y: number } {
  const sliceBox = slice.getBoundingClientRect();
  const overlayBox = overlay.getBoundingClientRect();
  return {
    x: sliceBox.left + sliceBox.width / 2 - overlayBox.left,
    y: sliceBox.top + sliceBox.height / 2 - overlayBox.top,
  };
}
