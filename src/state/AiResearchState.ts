import type { TrendTarget } from '../ai/trendContext';

/** Lifecycle of an AI research interaction. */
export type AiResearchMode = 'idle' | 'selecting' | 'loading' | 'done' | 'error';

type Listener = () => void;
type Runner = (target: TrendTarget) => void;

/**
 * Observable state for the AI trend-research feature. Holds the API key, the
 * selection/loading lifecycle, and the streamed output. The chart stack reads
 * `mode` to highlight selectable single-country slope charts; the panel reads
 * everything to render its controls and output.
 */
export class AiResearchState {
  private apiKeyVal = '';
  private modeVal: AiResearchMode = 'idle';
  private outputVal = '';
  private errorVal = '';
  private runner: Runner | null = null;
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // --- reads ---

  apiKey(): string {
    return this.apiKeyVal;
  }

  hasKey(): boolean {
    return this.apiKeyVal.trim().length > 0;
  }

  mode(): AiResearchMode {
    return this.modeVal;
  }

  output(): string {
    return this.outputVal;
  }

  error(): string {
    return this.errorVal;
  }

  // --- mutations ---

  /** Stored without notify: the panel owns its own password input. */
  setApiKey(value: string): void {
    this.apiKeyVal = value;
  }

  /** Registered by the panel to actually run the API call when a target is picked. */
  onRun(runner: Runner): void {
    this.runner = runner;
  }

  /** Arm selection mode so the user can click a single-country slope chart. */
  beginSelection(): void {
    if (!this.hasKey()) return;
    this.modeVal = 'selecting';
    this.errorVal = '';
    this.notify();
  }

  cancelSelection(): void {
    if (this.modeVal === 'selecting') {
      this.modeVal = 'idle';
      this.notify();
    }
  }

  /** Called by a selected chart; transitions to loading and kicks off the run. */
  select(target: TrendTarget): void {
    if (this.modeVal !== 'selecting') return;
    this.modeVal = 'loading';
    this.outputVal = '';
    this.errorVal = '';
    this.notify();
    this.runner?.(target);
  }

  appendOutput(delta: string): void {
    this.outputVal += delta;
    this.notify();
  }

  finish(full: string): void {
    if (full) this.outputVal = full;
    this.modeVal = 'done';
    this.notify();
  }

  fail(message: string): void {
    this.errorVal = message;
    this.modeVal = 'error';
    this.notify();
  }
}
