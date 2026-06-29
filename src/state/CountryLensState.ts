import { LENS_WIDTH } from '../config';

export interface PlacedLens {
  readonly id: string;
  startYear: number;
  endYear: number;
}

type Listener = () => void;

// Module-private counter for stable unique ids; no crypto needed (ids are internal keys only).
let _nextId = 0;

function makeId(): string {
  return `lens-${_nextId++}`;
}

/**
 * Holds the single shared lens window, coordinated across every chart: placing, moving,
 * resizing, or removing it affects all charts at once because they all read this one lens.
 * Spans are clamped to a minimum and the visible year range only — there is no maximum.
 */
export class CountryLensState {
  private lens: PlacedLens | null = null;
  private readonly listeners = new Set<Listener>();

  // --- observer ---

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // --- reads ---

  /** The current lens, or null when none is placed. */
  get(): PlacedLens | null {
    return this.lens;
  }

  // --- mutations ---

  /** Places (replacing any existing) the single lens at the given window, clamped to min span. */
  place(input: { startYear: number; endYear: number }): PlacedLens {
    const span = Math.max(LENS_WIDTH.min, input.endYear - input.startYear);
    this.lens = { id: makeId(), startYear: input.startYear, endYear: input.startYear + span };
    this.notify();
    return this.lens;
  }

  /** Shifts the lens by deltaYears, clamped so it stays within yearRange. */
  move(deltaYears: number, yearRange?: [number, number]): void {
    if (!this.lens) return;
    const span = this.lens.endYear - this.lens.startYear;
    let start = Math.round(this.lens.startYear + deltaYears);
    let end = Math.round(this.lens.endYear + deltaYears);
    if (yearRange) {
      if (start < yearRange[0]) { start = yearRange[0]; end = start + span; }
      else if (end > yearRange[1]) { end = yearRange[1]; start = end - span; }
    }
    this.lens = { ...this.lens, startYear: start, endYear: end };
    this.notify();
  }

  /** Moves only the start boundary; span clamped to >= min, start clamped to yearRange. */
  resizeLeft(deltaYears: number, yearRange?: [number, number]): void {
    if (!this.lens) return;
    const span = Math.max(LENS_WIDTH.min, this.lens.endYear - (this.lens.startYear + deltaYears));
    let start = Math.round(this.lens.endYear - span);
    if (yearRange) start = Math.max(yearRange[0], start);
    this.lens = { ...this.lens, startYear: start };
    this.notify();
  }

  /** Moves only the end boundary; span clamped to >= min, end clamped to yearRange. */
  resizeRight(deltaYears: number, yearRange?: [number, number]): void {
    if (!this.lens) return;
    const span = Math.max(LENS_WIDTH.min, (this.lens.endYear + deltaYears) - this.lens.startYear);
    let end = Math.round(this.lens.startYear + span);
    if (yearRange) end = Math.min(yearRange[1], end);
    this.lens = { ...this.lens, endYear: end };
    this.notify();
  }

  /** Resizes to newSpan anchored at start; if the end overflows yearRange it anchors right instead. */
  resize(newSpan: number, yearRange?: [number, number]): void {
    if (!this.lens) return;
    const span = Math.max(LENS_WIDTH.min, newSpan);
    let start = this.lens.startYear;
    let end = start + span;
    if (yearRange && end > yearRange[1]) {
      end = yearRange[1];
      start = Math.max(yearRange[0], end - span);
    }
    this.lens = { ...this.lens, startYear: start, endYear: end };
    this.notify();
  }

  /** Removes the lens (no-op when none is placed). */
  clear(): void {
    if (!this.lens) return;
    this.lens = null;
    this.notify();
  }
}
