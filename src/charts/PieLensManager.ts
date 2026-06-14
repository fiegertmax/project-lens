import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { PieLensLevel, PieLensRecord, PieLensState } from '../state/PieLensState';
import { createLensDragSweeper } from '../ui/lens-drag-sweeper';
import { PieLens } from './PieLens';

export interface PieLensManagerOptions {
  overlay: HTMLElement;
  /** The whole pie chart container — used to find every slice for highlighting,
   *  including those inside floating lens charts. */
  chartRoot: HTMLElement;
  state: PieLensState;
  dataset: EmissionsDataset;
  getYear(): number;
}

/** Reconciles the floating lens DOM with PieLensState. Owns collision-aware initial
 *  placement and per-lens drag (reposition vs retarget). */
export class PieLensManager {
  private readonly overlay: HTMLElement;
  private readonly chartRoot: HTMLElement;
  private readonly state: PieLensState;
  private readonly dataset: EmissionsDataset;
  private readonly getYear: () => number;
  private readonly lenses = new Map<string, PieLens>();
  private dragSession: DragSession | null = null;

  constructor(opts: PieLensManagerOptions) {
    this.overlay = opts.overlay;
    this.chartRoot = opts.chartRoot;
    this.state = opts.state;
    this.dataset = opts.dataset;
    this.getYear = opts.getYear;
    this.state.subscribe(() => this.reconcile());
    this.reconcile();
  }

  /** Re-render slice values without recreating DOM (e.g. on year change). */
  redrawAll(): void {
    for (const lens of this.lenses.values()) lens.redraw();
    this.applyHighlights();
  }

  /** Walks every `.pie-slice` under the chart root and tags those whose name matches
   *  an active lens with `.pie-slice--lensed` + `data-lens-id`. Each newly-tagged slice
   *  also gets a pointer-drag handler so the user can drag the source slice onto another
   *  same-level slice to retarget the lens (the lens window stays put). */
  applyHighlights(): void {
    const byTarget = new Map<string, string>();
    for (const lens of this.state.list()) byTarget.set(lens.target, lens.id);

    const slices = this.chartRoot.querySelectorAll<SVGGElement>('.pie-slice');
    for (const slice of Array.from(slices)) {
      const name = slice.dataset.sliceName;
      const lensId = name ? byTarget.get(name) : undefined;
      if (lensId) {
        slice.classList.add('pie-slice--lensed');
        slice.dataset.lensId = lensId;
        this.ensureSliceDragHandler(slice);
      } else {
        slice.classList.remove('pie-slice--lensed');
        delete slice.dataset.lensId;
      }
    }
  }

  /** Attach (once per slice DOM lifetime) a drag handler that retargets the slice's
   *  bound lens onto another same-level slice. Slices are re-created on every render,
   *  so the dataset flag naturally resets when the base pie redraws. */
  private ensureSliceDragHandler(slice: SVGGElement): void {
    if (slice.dataset.lensDragAttached === 'true') return;
    slice.dataset.lensDragAttached = 'true';
    createLensDragSweeper<SVGGElement>(slice, {
      canStart: () => {
        const id = slice.dataset.lensId;
        return Boolean(id && this.lenses.has(id));
      },
      resolveTarget: (x, y) => {
        const id = slice.dataset.lensId;
        const lens = id ? this.lenses.get(id) : undefined;
        if (!lens) return null;
        const level = lens.root.dataset.lensLevel as PieLensLevel;
        return sliceUnder(x, y, level);
      },
      onHover: (target, previous) => {
        previous?.classList.remove('pie-slice--drop-target');
        target?.classList.add('pie-slice--drop-target');
      },
      onDrop: (target, { shift }) => {
        const id = slice.dataset.lensId;
        if (!id || shift || !target) return;
        const name = target.dataset.sliceName;
        if (name) this.state.retarget(id, name);
      },
    });
  }

  /** Pick a non-overlapping position near `anchor` inside the overlay. */
  pickPosition(anchor: { x: number; y: number }): { x: number; y: number } {
    const { width: maxW, height: maxH } = this.overlay.getBoundingClientRect();
    const w = PieLens.WIDTH;
    const h = PieLens.HEIGHT;
    const candidates = this.spiral(anchor, 24);
    for (const c of candidates) {
      const x = clamp(c.x, 8, Math.max(8, maxW - w - 8));
      const y = clamp(c.y, 8, Math.max(8, maxH - h - 8));
      if (!this.overlaps({ x, y, w, h })) return { x, y };
    }
    return {
      x: clamp(anchor.x, 8, Math.max(8, maxW - w - 8)),
      y: clamp(anchor.y, 8, Math.max(8, maxH - h - 8)),
    };
  }

  /** Find which existing lens, if any, is being asked to retarget by drop. */
  private overlaps(box: { x: number; y: number; w: number; h: number }): boolean {
    for (const lens of this.lenses.values()) {
      const p = lens.position();
      if (
        box.x < p.x + PieLens.WIDTH &&
        box.x + box.w > p.x &&
        box.y < p.y + PieLens.HEIGHT &&
        box.y + box.h > p.y
      )
        return true;
    }
    return false;
  }

  /** Outward square-ring spiral around the anchor — cheap and good-enough placement. */
  private spiral(anchor: { x: number; y: number }, step: number): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = [anchor];
    for (let ring = 1; ring <= 12; ring++) {
      const r = ring * step;
      for (let dx = -r; dx <= r; dx += step) {
        points.push({ x: anchor.x + dx, y: anchor.y - r });
        points.push({ x: anchor.x + dx, y: anchor.y + r });
      }
      for (let dy = -r + step; dy <= r - step; dy += step) {
        points.push({ x: anchor.x - r, y: anchor.y + dy });
        points.push({ x: anchor.x + r, y: anchor.y + dy });
      }
    }
    return points;
  }

  private reconcile(): void {
    const desired = new Map(this.state.list().map((r) => [r.id, r]));

    // Remove gone lenses
    for (const [id, lens] of this.lenses) {
      if (!desired.has(id)) {
        lens.remove();
        this.lenses.delete(id);
      }
    }

    // Create or update kept ones
    for (const record of desired.values()) {
      const existing = this.lenses.get(record.id);
      if (existing) existing.apply(record);
      else this.create(record);
    }

    this.applyHighlights();
  }

  private create(record: PieLensRecord): void {
    const lens = new PieLens(this.overlay, record, this.dataset, {
      onClose: (id) => this.state.remove(id),
      onDragStart: (id, event) => this.beginDrag(id, event),
      getYear: () => this.getYear(),
    });
    this.lenses.set(record.id, lens);
  }

  /** Header pointer-down: track movement, highlight valid drop targets, then on
   *  release either retarget (if over a same-level slice) or just reposition. */
  private beginDrag(id: string, event: PointerEvent): void {
    if (event.button !== 0) return;
    const lens = this.lenses.get(id);
    if (!lens) return;
    const start = lens.position();
    this.dragSession = {
      id,
      level: lens.root.dataset.lensLevel as PieLensLevel,
      origin: { x: event.clientX, y: event.clientY },
      startPosition: start,
      hovered: null,
    };
    // Hide from elementFromPoint so the dragged lens doesn't shadow underlying slices.
    lens.root.classList.add('pie-lens--dragging');
    document.body.classList.add('pie-lens-dragging');
    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
  }

  private onDragMove = (event: PointerEvent): void => {
    if (!this.dragSession) return;
    const s = this.dragSession;
    const dx = event.clientX - s.origin.x;
    const dy = event.clientY - s.origin.y;
    const lens = this.lenses.get(s.id);
    if (!lens) return;
    lens.root.style.left = `${s.startPosition.x + dx}px`;
    lens.root.style.top = `${s.startPosition.y + dy}px`;

    const target = sliceUnder(event.clientX, event.clientY, s.level);
    if (s.hovered !== target) {
      s.hovered?.classList.remove('pie-slice--drop-target');
      target?.classList.add('pie-slice--drop-target');
      s.hovered = target;
    }
  };

  private onDragEnd = (event: PointerEvent): void => {
    if (!this.dragSession) return;
    const s = this.dragSession;
    s.hovered?.classList.remove('pie-slice--drop-target');
    document.body.classList.remove('pie-lens-dragging');
    this.lenses.get(s.id)?.root.classList.remove('pie-lens--dragging');
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);

    const dx = event.clientX - s.origin.x;
    const dy = event.clientY - s.origin.y;
    const overlayBox = this.overlay.getBoundingClientRect();
    const newPosition = clampInside(
      { x: s.startPosition.x + dx, y: s.startPosition.y + dy },
      overlayBox.width,
      overlayBox.height,
    );

    const dropTarget = sliceUnder(event.clientX, event.clientY, s.level);
    if (dropTarget) {
      const target = dropTarget.dataset.sliceName ?? dropTarget.dataset.sliceKey;
      if (target) this.state.retarget(s.id, target);
    }
    this.state.moveTo(s.id, newPosition);
    this.dragSession = null;
  };
}

interface DragSession {
  id: string;
  level: PieLensLevel;
  origin: { x: number; y: number };
  startPosition: { x: number; y: number };
  hovered: SVGGElement | null;
}

/** Slice element under the pointer that matches the dragged lens's drill level
 *  (continent lens retargets to continents; source lens retargets to countries). */
function sliceUnder(x: number, y: number, lensLevel: PieLensLevel): SVGGElement | null {
  const expected = lensLevel === 'country' ? 'continent' : 'country';
  const el = document.elementFromPoint(x, y);
  const slice = el?.closest('.pie-slice') as SVGGElement | null;
  if (!slice) return null;
  if (slice.dataset.sliceLevel !== expected || slice.dataset.sliceDisabled === 'true') return null;
  return slice;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampInside(pos: { x: number; y: number }, w: number, h: number): { x: number; y: number } {
  return {
    x: clamp(pos.x, 8, Math.max(8, w - PieLens.WIDTH - 8)),
    y: clamp(pos.y, 8, Math.max(8, h - PieLens.HEIGHT - 8)),
  };
}
