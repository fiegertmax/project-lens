import type { CountryLensState, LensStage } from '../state/CountryLensState';

/**
 * Propagates move/resize gestures from one lens to all linked same-stage lenses
 * across every country (LENSUI-04). Delta-based: every sibling shifts by the same
 * numeric delta, keeping individual positions intact between gestures.
 *
 * Does NOT subscribe to CountryLensState — it calls mutators directly to avoid
 * the notify→render→mutate re-entrancy risk (STATE.md LENS SYNC risk).
 */
export class LensSync {
  private readonly state: CountryLensState;

  constructor(state: CountryLensState) {
    this.state = state;
  }

  /**
   * Moves the origin lens by deltaYears and fans the same delta to every other
   * same-stage lens across all countries. All-or-nothing: if any sibling cannot
   * move (it would overlap a neighbouring-stage lens), none move — keeping siblings
   * locked in sync. yearRange is forwarded for boundary clamping.
   */
  moveLinkedLens(originCountry: string, originId: string, deltaYears: number, yearRange?: [number, number]): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;

    const targets = this.gestureTargets(origin.stage, originCountry, originId);
    if (!targets.every(t => this.state.canMoveLens(t.country, t.id, deltaYears, yearRange))) return;

    for (const t of targets) this.state.moveLens(t.country, t.id, deltaYears, yearRange);
  }

  /**
   * Resizes the origin lens to newSpan and fans the same span to every other
   * same-stage lens across all countries. All-or-nothing: if any sibling cannot
   * resize without overlapping, none resize. yearRange is forwarded so
   * boundary-aware clamping can anchor at chart edges instead of overflowing.
   */
  resizeLinkedLens(originCountry: string, originId: string, newSpan: number, yearRange?: [number, number]): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;

    const targets = this.gestureTargets(origin.stage, originCountry, originId);
    if (!targets.every(t => this.state.canResizeLens(t.country, t.id, newSpan, yearRange))) return;

    for (const t of targets) this.state.resizeLens(t.country, t.id, newSpan, yearRange);
  }

  /** Resizes the left (start) boundary of the lens and fans to all same-stage siblings. */
  resizeLinkedLensLeft(originCountry: string, originId: string, deltaYears: number, yearRange?: [number, number]): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;
    const targets = this.gestureTargets(origin.stage, originCountry, originId);
    if (!targets.every(t => this.state.canResizeLensLeft(t.country, t.id, deltaYears, yearRange))) return;
    for (const t of targets) this.state.resizeLensLeft(t.country, t.id, deltaYears, yearRange);
  }

  /** Resizes the right (end) boundary of the lens and fans to all same-stage siblings. */
  resizeLinkedLensRight(originCountry: string, originId: string, deltaYears: number, yearRange?: [number, number]): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;
    const targets = this.gestureTargets(origin.stage, originCountry, originId);
    if (!targets.every(t => this.state.canResizeLensRight(t.country, t.id, deltaYears, yearRange))) return;
    for (const t of targets) this.state.resizeLensRight(t.country, t.id, deltaYears, yearRange);
  }

  // --- private helpers ---

  private findLens(country: string, id: string) {
    return this.state.lensesFor(country).find(l => l.id === id) ?? null;
  }

  /** The origin plus every other same-stage lens across all countries, as {country, id} targets. */
  private gestureTargets(stage: LensStage, originCountry: string, originId: string): { country: string; id: string }[] {
    const targets = [{ country: originCountry, id: originId }];
    for (const { country, lens } of this.state.allLenses()) {
      if (lens.stage === stage && lens.id !== originId) targets.push({ country, id: lens.id });
    }
    return targets;
  }
}
