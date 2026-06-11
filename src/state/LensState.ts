import { LENS_WIDTH } from '../config';
import { LENS_EFFECTS } from '../lens/effects';
import type { LensEffectKey } from '../lens/effects';

export type LensPhase = 'idle' | 'active';

/** How lensed countries' derived series are combined / scaled. Mutually exclusive. */
export type LensCombineMode = 'off' | 'compare' | 'accumulate' | 'mean';

type Listener = () => void;

/** Observable configuration and lifecycle of the ChronoLens. */
export class LensState {
  private phase: LensPhase = 'idle';
  private effectKey: LensEffectKey;
  private width: number;
  private center: number;
  /** Compare by default: multiple lens targets should be comparable immediately. */
  private mode: LensCombineMode = 'compare';
  private readonly targets = new Set<string>();
  private readonly listeners = new Set<Listener>();

  constructor(effectKey: LensEffectKey, width: number, center: number) {
    this.effectKey = effectKey;
    this.width = width;
    this.center = center;
  }

  currentPhase(): LensPhase {
    return this.phase;
  }

  currentEffect(): LensEffectKey {
    return this.effectKey;
  }

  currentWidth(): number {
    return this.width;
  }

  centerYear(): number {
    return this.center;
  }

  isTarget(country: string): boolean {
    return this.targets.has(country);
  }

  /** The active combine/scale mode for lensed countries. */
  combineMode(): LensCombineMode {
    return this.mode;
  }

  targetCount(): number {
    return this.targets.size;
  }

  setEffect(effectKey: LensEffectKey): void {
    this.effectKey = effectKey;
    // Summing percentages is meaningless — fall back to compare for such effects.
    if (this.mode === 'accumulate' && !LENS_EFFECTS[effectKey].accumulable)
      this.mode = 'compare';
    this.notify();
  }

  setWidth(width: number): void {
    const clamped = Math.round(Math.min(LENS_WIDTH.max, Math.max(LENS_WIDTH.min, width)));
    if (clamped === this.width) return;
    this.width = clamped;
    this.notify();
  }

  setCenter(year: number): void {
    const rounded = Math.round(year);
    if (rounded === this.center) return;
    this.center = rounded;
    this.notify();
  }

  /** Switch to a mode, or back to 'off' when toggling the active one — exclusive. */
  toggleMode(mode: Exclude<LensCombineMode, 'off'>): void {
    this.mode = this.mode === mode ? 'off' : mode;
    this.notify();
  }

  /** Arm the lens: countries can now be lensed individually via the selector. */
  apply(): void {
    this.phase = 'active';
    this.notify();
  }

  /** Lens (or un-lens) a single country; only meaningful while active. */
  toggleTarget(country: string): void {
    if (this.targets.has(country)) this.targets.delete(country);
    else this.targets.add(country);
    this.notify();
  }

  /** Tear the lens down and clear the on-visualization selection. */
  reset(): void {
    this.phase = 'idle';
    this.mode = 'compare';
    this.targets.clear();
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
