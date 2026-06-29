import { scaleOrdinal, schemeTableau10 } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { MetricDefinition } from '../data/types';
import type { AppState } from '../state/AppState';
import type { CountryLensState } from '../state/CountryLensState';
import type { AiResearchState } from '../state/AiResearchState';
import { EmissionsChart } from './EmissionsChart';
import type { LineDragCallbacks } from './drag-types';

const MAIN_CHART_ID = '__main__';
let _rowCounter = 0;

type DropTarget =
  | { kind: 'chart'; chartId: string }
  | { kind: 'new-row' }
  | { kind: 'invalid' };

interface ChartGroup {
  chartId: string;
  countries: string[];
}

/** Orchestrates a fleet of EmissionsChart instances — one main chart plus extracted row charts. */
export class ChartArea {
  private readonly div: HTMLDivElement;
  private readonly rowContainer: HTMLDivElement;
  private readonly dropSpacer: HTMLDivElement;
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  // metric retained in constructor signature for API compatibility with app.ts
  private readonly unsub: () => void;

  private readonly lensState: CountryLensState;
  private readonly aiResearch: AiResearchState;

  // Main chart — always present, always receives newly selected countries
  private readonly mainGroup: ChartGroup = {
    chartId: MAIN_CHART_ID,
    countries: [],
  };
  private readonly mainChart: EmissionsChart;

  // Extracted row charts, one per dragged-out group
  private readonly rowGroups: ChartGroup[] = [];
  private readonly rowCharts = new Map<string, EmissionsChart>();

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
    aiResearch: AiResearchState,
  ) {
    this.dataset = dataset;
    this.state = state;
    void metric;
    this.lensState = lensState;
    this.aiResearch = aiResearch;

    this.div = document.createElement('div');
    this.div.className = 'chart-area';
    parent.appendChild(this.div);

    this.rowContainer = document.createElement('div');
    this.rowContainer.className = 'chart-area__rows';
    this.div.appendChild(this.rowContainer);

    // Build initial color scale before creating the main chart
    this.colorFor = this.buildColorFor([]);

    this.mainChart = new EmissionsChart(
      MAIN_CHART_ID,
      this.rowContainer,
      [],
      dataset,
      state,
    );
    this.mainChart.setLensState(this.lensState);
    this.mainChart.setAiResearch(this.aiResearch);

    this.dropSpacer = document.createElement('div');
    this.dropSpacer.className = 'chart-area__drop-spacer';
    this.div.appendChild(this.dropSpacer);

    this.onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.cancelDrag();
    };

    this.unsub = state.subscribe(() => this.reconcile());
    this.reconcile();
  }

  node(): HTMLDivElement {
    return this.div;
  }

  update(): void {
    this.reconcile();
  }

  destroy(): void {
    this.unsub();
    this.mainChart.destroy();
    for (const chart of this.rowCharts.values()) chart.destroy();
    this.rowCharts.clear();
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

    // (1) Rebuild shared color over full selection first
    this.colorFor = this.buildColorFor(selected);
    this.mainChart.colorFor = this.colorFor;

    // (2) Remove deselected countries from main group
    this.mainGroup.countries = this.mainGroup.countries.filter((c) => selectedSet.has(c));

    // (3) Remove deselected from row groups; destroy empty row charts
    for (let i = this.rowGroups.length - 1; i >= 0; i--) {
      const group = this.rowGroups[i];
      group.countries = group.countries.filter((c) => selectedSet.has(c));
      if (group.countries.length === 0) {
        this.rowCharts.get(group.chartId)?.destroy();
        this.rowCharts.delete(group.chartId);
        this.rowGroups.splice(i, 1);
      }
    }

    // (4) Add newly selected countries (not yet assigned to any chart) to main
    const assigned = new Set([
      ...this.mainGroup.countries,
      ...this.rowGroups.flatMap((g) => g.countries),
    ]);
    for (const c of selected) {
      if (!assigned.has(c)) this.mainGroup.countries.push(c);
    }

    // (5) Build drag callbacks
    const callbacks = this.buildCallbacks();
    this.mainChart.callbacks = callbacks;

    // (6) Create/update row charts and re-append in group order
    for (const group of this.rowGroups) {
      let chart = this.rowCharts.get(group.chartId);
      if (!chart) {
        chart = new EmissionsChart(
          group.chartId,
          this.rowContainer,
          group.countries,
          this.dataset,
          this.state,
        );
        chart.setLensState(this.lensState);
        chart.setAiResearch(this.aiResearch);
        this.rowCharts.set(group.chartId, chart);
      }
      chart.colorFor = this.colorFor;
      chart.callbacks = callbacks;
      chart.updateCountries(group.countries);
      this.rowContainer.appendChild(chart.node());
    }

    // (7) Update main chart country list (drives re-render via updateCountries → update)
    this.mainChart.colorFor = this.colorFor;
    this.mainChart.updateCountries(this.mainGroup.countries);
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
  // Ghost badge lifecycle
  // ---------------------------------------------------------------------------

  private handleDragStart(country: string, x: number, y: number): void {
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
  // Drop target detection
  // ---------------------------------------------------------------------------

  private dropTargetAt(x: number, y: number): DropTarget {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return { kind: 'new-row' };

    const chartEl = el.closest<HTMLElement>('.emissions-chart');
    if (chartEl) {
      const chartId = chartEl.dataset.chartId ?? MAIN_CHART_ID;
      return { kind: 'chart', chartId };
    }

    if (el.closest<HTMLElement>('.chart-area')) return { kind: 'new-row' };

    return { kind: 'invalid' };
  }

  private highlightDropTarget(x: number, y: number): void {
    this.clearDropHighlight();
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return;

    const chartEl = el.closest<HTMLElement>('.emissions-chart');
    if (chartEl) {
      chartEl.classList.add('chart-area__row--drop');
      this.prevDropEl = chartEl;
      return;
    }

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
        // Remove country from wherever it is; create a new single-country row chart
        this.removeFromSource(country);
        const newChartId = `__row-${_rowCounter++}__`;
        this.rowGroups.push({ chartId: newChartId, countries: [country] });
        this.reconcile();
        break;
      }
      case 'chart': {
        const { chartId } = target;
        // Find current source group
        const sourceGroup = this.findGroupOf(country);
        if (!sourceGroup) break; // not found — no-op
        if (sourceGroup.chartId === chartId) break; // dropped on own chart — no-op

        // Move country to target chart
        this.removeFromSource(country);
        const targetGroup = this.findGroupById(chartId);
        if (targetGroup) {
          if (!targetGroup.countries.includes(country)) targetGroup.countries.push(country);
        } else if (chartId === MAIN_CHART_ID) {
          if (!this.mainGroup.countries.includes(country)) this.mainGroup.countries.push(country);
        }
        this.reconcile();
        break;
      }
      case 'invalid':
        break;
    }
  }

  private removeFromSource(country: string): void {
    this.mainGroup.countries = this.mainGroup.countries.filter((c) => c !== country);
    for (const group of this.rowGroups) {
      group.countries = group.countries.filter((c) => c !== country);
    }
  }

  private findGroupOf(country: string): ChartGroup | null {
    if (this.mainGroup.countries.includes(country)) return this.mainGroup;
    return this.rowGroups.find((g) => g.countries.includes(country)) ?? null;
  }

  private findGroupById(chartId: string): ChartGroup | null {
    if (chartId === MAIN_CHART_ID) return this.mainGroup;
    return this.rowGroups.find((g) => g.chartId === chartId) ?? null;
  }
}
