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
   * valid siblings and the origin still move.
   */
  moveLinkedLens(originCountry: string, originId: string, deltaYears: number): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;

    // Snapshot stage/linked before any mutation.
    const { stage, linked } = origin;

    this.state.moveLens(originCountry, originId, deltaYears);

    if (linked) {
      for (const { country, lens } of this.linkedSiblings(stage, originId)) {
        this.state.moveLens(country, lens.id, deltaYears);
      }
    }
  }

  /**
   * Resizes the origin lens to newSpan. If the origin is linked, fans the same
   * span to every other linked lens of the same stage.
   */
  resizeLinkedLens(originCountry: string, originId: string, newSpan: number): void {
    const origin = this.findLens(originCountry, originId);
    if (!origin) return;

    const { stage, linked } = origin;

    this.state.resizeLens(originCountry, originId, newSpan);

    if (linked) {
      for (const { country, lens } of this.linkedSiblings(stage, originId)) {
        this.state.resizeLens(country, lens.id, newSpan);
      }
    }
  }

  // --- private helpers ---

  private findLens(country: string, id: string) {
    return this.state.lensesFor(country).find(l => l.id === id) ?? null;
  }

  /** All linked lenses of the given stage, excluding the origin id. */
  private linkedSiblings(stage: LensStage, excludeId: string) {
    return this.state.allLenses().filter(
      ({ lens }) => lens.linked && lens.stage === stage && lens.id !== excludeId,
    );
  }
}
