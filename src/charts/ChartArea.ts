import { scaleOrdinal, schemeTableau10 } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { MetricDefinition } from '../data/types';
import type { AppState } from '../state/AppState';
import type { CountryLensState } from '../state/CountryLensState';
import { CombinedChart } from './CombinedChart';
import type { LineDragCallbacks } from './drag-types';
import { LensSync } from './LensSync';
import { SingleCountryChart } from './SingleCountryChart';

type DropTarget =
  | { kind: 'new-row' }
  | { kind: 'combined' }
  | { kind: 'single-row'; country: string }
  | { kind: 'invalid' };

/** Orchestrates the combined chart and extracted single-country rows. */
export class ChartArea {
  private readonly div: HTMLDivElement;
  private readonly rowContainer: HTMLDivElement;
  private readonly combinedChart: CombinedChart;
  private readonly dropSpacer: HTMLDivElement;
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  private readonly metric: MetricDefinition;
  private readonly unsub: () => void;

  private readonly lensState: CountryLensState;
  private readonly lensSync: LensSync;

  // Extraction state — never written to AppState (D-14)
  private extractedCountries: string[] = [];
  private readonly rows = new Map<string, SingleCountryChart>();

  // Shared color scale; rebuilt over full selection on every reconcile
  private colorFor!: (c: string) => string;

  // Ghost drag state
  private ghost: HTMLDivElement | null = null;
  private prevDropEl: HTMLElement | null = null;
  private readonly onEscape: (e: KeyboardEvent) => void;

  constructor(
    parent: HTMLElement,
    dataset: EmissionsDataset,
    state: AppState,
    metric: MetricDefinition,
    lensState: CountryLensState,
  ) {
    this.dataset = dataset;
    this.state = state;
    this.metric = metric;
    this.lensState = lensState;
    this.lensSync = new LensSync(lensState);

    this.div = document.createElement('div');
    this.div.className = 'chart-area';
    parent.appendChild(this.div);

    this.rowContainer = document.createElement('div');
    this.rowContainer.className = 'chart-area__rows';
    this.div.appendChild(this.rowContainer);

    this.combinedChart = new CombinedChart(this.rowContainer, dataset, state, metric);
    // Combined chart root participates in drop detection as a chart-area__row
    this.combinedChart.node().classList.add('chart-area__row');
    // Wire lens state into the combined chart ONCE — it persists for the app lifetime
    // (single-country rows are re-wired per reconcile, but the combined chart is never destroyed). CLENS-01..04
    this.combinedChart.setLensState(this.lensState, this.lensSync);

    this.dropSpacer = document.createElement('div');
    this.dropSpacer.className = 'chart-area__drop-spacer';
    this.div.appendChild(this.dropSpacer);

    // Ctrl/Cmd wheel resize is now handled per-lens in SingleCountryChart (Plan 04).

    this.onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.cancelDrag();
    };

    this.unsub = state.subscribe(() => this.reconcile());
    this.reconcile();
  }

  /** Root element used by app.ts to toggle visibility. */
  node(): HTMLDivElement {
    return this.div;
  }

  update(): void {
    this.reconcile();
  }

  destroy(): void {
    this.unsub();
    this.combinedChart.destroy();
    for (const chart of this.rows.values()) chart.destroy();
    this.rows.clear();
    this.div.remove();
  }

  // ---------------------------------------------------------------------------
  // Color scale
  // ---------------------------------------------------------------------------

  private buildColorFor(selectedCountries: string[]): (c: string) => string {
    const scale = scaleOrdinal(selectedCountries, schemeTableau10 as readonly string[]);
    return (c: string) => scale(c);
  }

  // ---------------------------------------------------------------------------
  // Reconcile loop
  // ---------------------------------------------------------------------------

  private reconcile(): void {
    const selected = this.state.selectedCountries();
    const selectedSet = new Set(selected);

    // (1) Purge extracted countries no longer in selection
    this.extractedCountries = this.extractedCountries.filter((c) => selectedSet.has(c));

    // (2) Destroy rows for countries removed from selection OR moved back to combined
    const extractedSet = new Set(this.extractedCountries);
    for (const [country, chart] of this.rows) {
      if (!selectedSet.has(country) || !extractedSet.has(country)) {
        chart.destroy();
        this.rows.delete(country);
      }
    }

    // (3) Rebuild shared color over full selection
    this.colorFor = this.buildColorFor(selected);
    this.combinedChart.colorFor = this.colorFor;

    // (4) Build the drag callbacks object to wire into each chart
    const callbacks = this.buildCallbacks();

    // Wire callbacks into combined chart
    this.combinedChart.callbacks = callbacks;

    // (5) Create rows for newly extracted countries; wire lens state/sync into each
    for (const country of this.extractedCountries) {
      if (!this.rows.has(country)) {
        const chart = new SingleCountryChart(
          this.rowContainer,
          country,
          this.dataset,
          this.metric,
          this.colorFor,
        );
        chart.callbacks = callbacks;
        chart.setLensState(this.lensState, this.lensSync);
        this.rows.set(country, chart);
      }
    }

    // (6) Re-append rows in extraction order; keep drop spacer last
    for (const country of this.extractedCountries) {
      const chart = this.rows.get(country);
      if (chart) this.rowContainer.appendChild(chart.node());
    }
    // dropSpacer is appended to this.div (below rowContainer), already in correct position

    // (7) Update year range on all single-country rows
    const yearRange = this.state.yearRange();
    const includeLUC = this.state.includeLandUseChange();
    for (const chart of this.rows.values()) chart.update(yearRange, includeLUC);

    // (8) Drive combined chart country list (after rows are updated so extraction is visible)
    const combinedCountries = selected.filter((c) => !this.extractedCountries.includes(c));
    this.combinedChart.updateCountries(combinedCountries);
  }

  // ---------------------------------------------------------------------------
  // Drag callbacks factory
  // ---------------------------------------------------------------------------

  private buildCallbacks(): LineDragCallbacks {
    return {
      onDragStart: (country, x, y) => this.handleDragStart(country, x, y),
      onDragMove: (country, x, y) => this.handleDragMove(country, x, y),
      onDragEnd: (country, x, y) => this.handleDragEnd(country, x, y),
    };
  }

  // ---------------------------------------------------------------------------
  // Ghost badge lifecycle (adapted from lens-drag-sweeper.ts)
  // ---------------------------------------------------------------------------

  private handleDragStart(country: string, x: number, y: number): void {
    // Create ghost pill badge — textContent only (T-02-01 XSS)
    this.ghost = document.createElement('div');
    this.ghost.className = 'line-ghost';
    this.ghost.textContent = country;
    this.ghost.style.color = this.colorFor(country);
    document.body.appendChild(this.ghost);
    document.body.classList.add('line-dragging');
    this.positionGhost(x, y);

    document.addEventListener('keydown', this.onEscape);
  }

  private handleDragMove(_country: string, x: number, y: number): void {
    this.positionGhost(x, y);
    this.highlightDropTarget(x, y);
  }

  private handleDragEnd(country: string, x: number, y: number): void {
    const target = this.dropTargetAt(x, y);
    this.applyDropOutcome(country, target);
    this.cleanupDrag();
  }

  private cancelDrag(): void {
    // Escape: clean up without any state mutation (no state change, no reconcile)
    this.cleanupDrag();
  }

  private cleanupDrag(): void {
    if (this.ghost) {
      this.ghost.remove();
      this.ghost = null;
    }
    document.body.classList.remove('line-dragging');
    this.clearDropHighlight();
    document.removeEventListener('keydown', this.onEscape);
    this.prevDropEl = null;
  }

  private positionGhost(x: number, y: number): void {
    if (!this.ghost) return;
    this.ghost.style.left = `${x + 12}px`;
    this.ghost.style.top = `${y + 12}px`;
  }

  // ---------------------------------------------------------------------------
  // Drop target detection (elementFromPoint + closest)
  // ---------------------------------------------------------------------------

  private dropTargetAt(x: number, y: number): DropTarget {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return { kind: 'new-row' };

    // Check combined first — combined root has both .combined-chart and .chart-area__row
    const combined = el.closest<HTMLElement>('.combined-chart');
    if (combined) return { kind: 'combined' };

    // Check single-country row (has data-country attribute)
    const row = el.closest<HTMLElement>('.chart-area__row');
    if (row && row.dataset.country) {
      return { kind: 'single-row', country: row.dataset.country };
    }

    // Spacer, gap between rows, or anywhere else within the chart area → extract as new row
    if (el.closest<HTMLElement>('.chart-area')) return { kind: 'new-row' };

    return { kind: 'invalid' };
  }

  private highlightDropTarget(x: number, y: number): void {
    this.clearDropHighlight();
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return;

    const combined = el.closest<HTMLElement>('.combined-chart');
    if (combined) {
      combined.classList.add('chart-area__row--drop');
      this.prevDropEl = combined;
      return;
    }

    const row = el.closest<HTMLElement>('.chart-area__row');
    if (row && row.dataset.country) {
      row.classList.add('chart-area__row--drop');
      this.prevDropEl = row;
      return;
    }

    // Hovering over spacer, gap, or anywhere else within the chart area → highlight spacer
    if (el.closest<HTMLElement>('.chart-area')) {
      this.dropSpacer.classList.add('chart-area__drop-spacer--drop');
      this.prevDropEl = this.dropSpacer;
    }
  }

  private clearDropHighlight(): void {
    if (this.prevDropEl) {
      this.prevDropEl.classList.remove('chart-area__row--drop', 'chart-area__drop-spacer--drop');
      this.prevDropEl = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Drop outcomes
  // ---------------------------------------------------------------------------

  private applyDropOutcome(country: string, target: DropTarget): void {
    switch (target.kind) {
      case 'new-row': {
        // DRAG-01: drag to spacer → extract into own row
        if (!this.extractedCountries.includes(country)) {
          this.extractedCountries.push(country);
          this.reconcile();
        }
        break;
      }
      case 'combined': {
        // D-12: return to combined chart
        const idx = this.extractedCountries.indexOf(country);
        if (idx !== -1) {
          this.extractedCountries.splice(idx, 1);
          this.reconcile();
        }
        break;
      }
      case 'single-row': {
        // DRAG-02: move to extracted (as its own row), reorder adjacent to target
        if (target.country === country) break; // drop on own row — no-op
        if (!this.extractedCountries.includes(country)) {
          this.extractedCountries.push(country);
        }
        // Reorder: place country adjacent to target
        const targetIdx = this.extractedCountries.indexOf(target.country);
        const dragIdx = this.extractedCountries.indexOf(country);
        if (targetIdx !== -1 && dragIdx !== -1 && dragIdx !== targetIdx) {
          this.extractedCountries.splice(dragIdx, 1);
          const newTargetIdx = this.extractedCountries.indexOf(target.country);
          this.extractedCountries.splice(newTargetIdx + 1, 0, country);
        }
        this.reconcile();
        break;
      }
      case 'invalid':
        // No state change on invalid drop
        break;
    }
  }
}
