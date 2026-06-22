import { LENS_STAGE_WIDTH } from '../config';

// '__' prefix is not a valid OWID entity name, so no collision with real country keys (CLENS-03).
export const COMBINED_CHART_KEY = '__combined__';

export type LensStage = 1 | 2 | 3;

export interface PlacedLens {
  readonly id: string;
  stage: LensStage;
  startYear: number;
  endYear: number;
  /** True when lens was placed while Shift was held — consumed by LensSync. */
  linked: boolean;
}

type Listener = () => void;

// Module-private counter for stable unique ids; no crypto needed (ids are internal map keys only).
let _nextId = 0;

function makeId(): string {
  return `lens-${_nextId++}`;
}

/** Manages per-country placed lenses with non-overlap enforcement and progressive stage gating. */
export class CountryLensState {
  private readonly byCountry = new Map<string, PlacedLens[]>();
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

  /** Returns a shallow copy so callers cannot mutate the internal array. */
  lensesFor(country: string): PlacedLens[] {
    return [...(this.byCountry.get(country) ?? [])];
  }

  /** Flattened view used by availableStages() and LensSync. */
  allLenses(): { country: string; lens: PlacedLens }[] {
    const result: { country: string; lens: PlacedLens }[] = [];
    for (const [country, lenses] of this.byCountry) {
      for (const lens of lenses) result.push({ country, lens });
    }
    return result;
  }

  /**
   * Stage gating (LENS-03): always returns [1]; adds 2 once any stage-1 lens exists;
   * adds 3 once any stage-2 lens exists (stage 2 must be present before 3 becomes available).
   */
  availableStages(): LensStage[] {
    const all = this.allLenses();
    const stages: LensStage[] = [1];
    if (all.some(({ lens }) => lens.stage === 1)) stages.push(2);
    if (all.some(({ lens }) => lens.stage === 2)) stages.push(3);
    return stages;
  }

  // --- mutations ---

  /**
   * Places a new lens on the given country. Returns the created lens, or null if the
   * proposed window overlaps an existing lens on the same country (LENS-04).
   */
  placeLens(
    country: string,
    input: { stage: LensStage; startYear: number; endYear: number; linked?: boolean },
  ): PlacedLens | null {
    const span = Math.min(
      LENS_STAGE_WIDTH.max,
      Math.max(LENS_STAGE_WIDTH.min, input.endYear - input.startYear),
    );
    const candidate: PlacedLens = {
      id: makeId(),
      stage: input.stage,
      startYear: input.startYear,
      endYear: input.startYear + span,
      linked: input.linked ?? false,
    };

    const existing = this.byCountry.get(country) ?? [];
    if (existing.some(l => this.overlaps(candidate, l))) return null;

    const updated = [...existing, candidate].sort((a, b) => a.startYear - b.startYear);
    this.byCountry.set(country, updated);
    this.notify();
    return candidate;
  }

  /**
   * Shifts the lens by deltaYears. When yearRange is provided, clamps the result so
   * startYear >= yearRange[0] and endYear <= yearRange[1].
   * Rejected without notify if the shifted window would overlap another lens.
   */
  moveLens(country: string, id: string, deltaYears: number, yearRange?: [number, number]): boolean {
    const lenses = this.byCountry.get(country);
    if (!lenses) return false;
    const idx = lenses.findIndex(l => l.id === id);
    if (idx === -1) return false;

    const lens = lenses[idx];
    const span = lens.endYear - lens.startYear;
    let newStart = Math.round(lens.startYear + deltaYears);
    let newEnd = Math.round(lens.endYear + deltaYears);

    if (yearRange) {
      if (newStart < yearRange[0]) {
        newStart = yearRange[0];
        newEnd = yearRange[0] + span;
      } else if (newEnd > yearRange[1]) {
        newEnd = yearRange[1];
        newStart = yearRange[1] - span;
      }
    }

    const moved: PlacedLens = {
      ...lens,
      startYear: newStart,
      endYear: newEnd,
    };
    const others = lenses.filter(l => l.id !== id);
    if (others.some(l => this.overlaps(moved, l))) return false;

    lenses[idx] = moved;
    this.byCountry.set(country, [...lenses].sort((a, b) => a.startYear - b.startYear));
    this.notify();
    return true;
  }

  /**
   * Resizes a lens by setting endYear = startYear + clamp(newSpan, min, max).
   * When yearRange is provided: if the new endYear would exceed yearRange[1], anchors
   * endYear at the boundary and extends startYear left instead (and vice-versa at yearRange[0]).
   * Rejected without notify if the resized window would overlap another lens.
   */
  resizeLens(country: string, id: string, newSpan: number, yearRange?: [number, number]): boolean {
    const lenses = this.byCountry.get(country);
    if (!lenses) return false;
    const idx = lenses.findIndex(l => l.id === id);
    if (idx === -1) return false;

    const lens = lenses[idx];
    const clamped = Math.min(LENS_STAGE_WIDTH.max, Math.max(LENS_STAGE_WIDTH.min, newSpan));

    let newStartYear = lens.startYear;
    let newEndYear = lens.startYear + clamped;

    if (yearRange) {
      if (newEndYear > yearRange[1]) {
        // Right boundary hit: anchor endYear, extend startYear left
        newEndYear = yearRange[1];
        newStartYear = Math.max(yearRange[0], yearRange[1] - clamped);
      } else if (newStartYear < yearRange[0]) {
        // Left boundary hit: anchor startYear, extend endYear right
        newStartYear = yearRange[0];
        newEndYear = Math.min(yearRange[1], yearRange[0] + clamped);
      }
    }

    const resized: PlacedLens = { ...lens, startYear: newStartYear, endYear: newEndYear };
    const others = lenses.filter(l => l.id !== id);
    if (others.some(l => this.overlaps(resized, l))) return false;

    lenses[idx] = resized;
    this.byCountry.set(country, [...lenses].sort((a, b) => a.startYear - b.startYear));
    this.notify();
    return true;
  }

  /** Removes a lens by id and fires notify. */
  removeLens(country: string, id: string): void {
    const lenses = this.byCountry.get(country);
    if (!lenses) return;
    const filtered = lenses.filter(l => l.id !== id);
    if (filtered.length === lenses.length) return;
    this.byCountry.set(country, filtered);
    this.notify();
  }

  /** Removes all lenses across all countries and fires a single notify. */
  clearAll(): void {
    if (this.byCountry.size === 0) return;
    this.byCountry.clear();
    this.notify();
  }

  /** Removes all lenses of the given stage across all countries and fires a single notify. */
  removeStage(stage: LensStage): void {
    let changed = false;
    for (const [country, lenses] of this.byCountry) {
      const filtered = lenses.filter(l => l.stage !== stage);
      if (filtered.length !== lenses.length) {
        this.byCountry.set(country, filtered);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  // --- helpers ---

  /**
   * Strict overlap: shared boundaries (a.endYear === b.startYear) are NOT overlapping
   * so adjacent slope-chart segments can share a boundary year (SLOPE-05).
   */
  private overlaps(a: PlacedLens, b: PlacedLens): boolean {
    return a.startYear < b.endYear && b.startYear < a.endYear;
  }
}
