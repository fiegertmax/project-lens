import { LENS_WIDTH } from '../config';
import type { LensEffectKey } from '../lens/effects';

export type LensPhase = 'idle' | 'selecting' | 'active';

type Listener = () => void;

/** Observable configuration and lifecycle of the ChronoLens. */
export class LensState {
  private phase: LensPhase = 'idle';
  private effectKey: LensEffectKey;
  private width: number;
  private center: number;
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

  targetCount(): number {
    return this.targets.size;
  }

  setEffect(effectKey: LensEffectKey): void {
    this.effectKey = effectKey;
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

  /** Enter country-selection mode. */
  start(): void {
    this.phase = 'selecting';
    this.notify();
  }

  toggleTarget(country: string): void {
    if (this.targets.has(country)) this.targets.delete(country);
    else this.targets.add(country);
    this.notify();
  }

  /** Activate the draggable lens (requires at least one target). */
  activate(): void {
    if (this.targets.size === 0) return;
    this.phase = 'active';
    this.notify();
  }

  /** Tear the lens down and clear the on-visualization selection. */
  reset(): void {
    this.phase = 'idle';
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
