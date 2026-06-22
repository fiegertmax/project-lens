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
   * Moves the origin lens by deltaYears. If the origin is linked, fans the same
   * delta to every other linked lens of the same stage. Sibling conflicts are
   * silently skipped (CountryLensState.moveLens returns false) — all other
   * valid siblings and the origin still move. yearRange is forwarded for
   * boundary clamping so lenses cannot be dragged outside the chart.
   */
  moveLinkedLens(originCountry: string, originId: string, deltaYears: number, yearRange?: [number, number]): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;

    this.state.moveLens(originCountry, originId, deltaYears, yearRange);

    for (const { country, lens } of this.stageSiblings(origin.stage, originId)) {
      this.state.moveLens(country, lens.id, deltaYears, yearRange);
    }
  }

  /**
   * Resizes the origin lens to newSpan and fans the same span to every other
   * lens of the same stage across all countries. yearRange is forwarded so
   * boundary-aware clamping can anchor at chart edges instead of overflowing.
   */
  resizeLinkedLens(originCountry: string, originId: string, newSpan: number, yearRange?: [number, number]): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;

    this.state.resizeLens(originCountry, originId, newSpan, yearRange);

    for (const { country, lens } of this.stageSiblings(origin.stage, originId)) {
      this.state.resizeLens(country, lens.id, newSpan, yearRange);
    }
  }

  // --- private helpers ---

  private findLens(country: string, id: string) {
    return this.state.lensesFor(country).find(l => l.id === id) ?? null;
  }

  /** All lenses of the given stage across all countries, excluding the origin id. */
  private stageSiblings(stage: LensStage, excludeId: string) {
    return this.state.allLenses().filter(
      ({ lens }) => lens.stage === stage && lens.id !== excludeId,
    );
  }
}
