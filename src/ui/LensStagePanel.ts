import { LENS_STAGE_WIDTH } from '../config';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { CHART_MARGIN } from '../charts/EmissionsChart';
import type { AppState } from '../state/AppState';
import type { CountryLensState, LensStage } from '../state/CountryLensState';
import { COMBINED_CHART_KEY } from '../state/CountryLensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { createLensDragSweeper } from './lens-drag-sweeper';
import { attachCursorTooltip } from './cursorTooltip';

/** The three stage numbers in display order. */
const STAGES: readonly LensStage[] = [1, 2, 3];

/** Returns the emissions chart element under (x, y), if any. */
function lensDropTargetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>('.emissions-chart') ?? null;
}

/** Sidebar panel: three progressively-revealed stage icons with paired remove buttons,
 *  and drag-to-place onto single-country charts. */
export class LensStagePanel {
  readonly root: HTMLDivElement;

  private readonly state: CountryLensState;
  private readonly appState: AppState;
  private readonly dataset: EmissionsDataset;
  private readonly stageButtons = new Map<LensStage, HTMLButtonElement>();
  private readonly removeButtons = new Map<LensStage, HTMLButtonElement>();

  constructor(parent: HTMLElement, state: CountryLensState, appState: AppState, dataset: EmissionsDataset) {
    this.state = state;
    this.appState = appState;
    this.dataset = dataset;
    const panel = new Collapsible(parent, 'Lens', 'lens-stage-panel');
    this.root = panel.root;

    this.buildStageIcons(panel.body);

    state.subscribe(() => this.syncStages());
    this.syncStages();
  }

  private buildStageIcons(parent: HTMLElement): void {
    const list = document.createElement('div');
    list.className = 'lens-stage-panel__list';

    for (const stage of STAGES) {
      const row = document.createElement('div');
      row.className = 'lens-stage-panel__row';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `lens-stage-icon lens-stage-icon--stage-${stage}`;
      // innerHTML is safe here: LENS_ICON is a trusted static SVG constant, not user data
      btn.innerHTML = LENS_ICON;
      attachCursorTooltip(btn, `Drag onto a country chart to place a lens. It highlights a time window and shows derived insights like rate of change or emissions per person.`);
      this.stageButtons.set(stage, btn);
      this.wireDrag(btn, stage);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = `lens-stage-panel__remove lens-stage-panel__remove--stage-${stage}`;
      removeBtn.textContent = 'Remove Lens';
      removeBtn.addEventListener('click', () => this.state.removeStage(stage));
      this.removeButtons.set(stage, removeBtn);

      row.append(btn, removeBtn);
      list.appendChild(row);
    }

    parent.appendChild(list);
  }

  private wireDrag(btn: HTMLButtonElement, stage: LensStage): void {
    createLensDragSweeper<HTMLElement>(btn, {
      resolveTarget: (x, y) => {
        const el = lensDropTargetAt(x, y);
        if (!el) return null;
        if (this.appState.metricMode() === 'per-capita') {
          const country = el.dataset.country;
          // Single-country charts without GDP data are not valid drop targets in per-capita mode.
          // The combined chart (no data-country) is always valid — it shows the scatter plot.
          if (country && !this.dataset.hasGdpData(country)) return null;
        }
        return el;
      },
      onHover: (target, previous) => {
        previous?.classList.remove('emissions-chart--drop');
        target?.classList.add('emissions-chart--drop');
      },
      // Place on each chart swept over while Shift is held (use chart center as fallback)
      onSweep: (target) => this.placeOn(target, stage, true, null),
      onDrop: (target, { shift, clientX }) => this.placeOn(target, stage, shift, clientX),
    });
  }

  private placeOn(chartEl: HTMLElement | null, stage: LensStage, shift: boolean, clientX: number | null): void {
    if (!chartEl) return;
    const key = chartEl.dataset.lensKey ?? COMBINED_CHART_KEY;
    // If a lens of this stage already exists elsewhere, inherit its boundaries so
    // the new lens starts in sync with its peers (drag/zoom moves all together).
    const sibling = this.state.allLenses().find(({ lens }) => lens.stage === stage);
    const { startYear, endYear } = sibling
      ? { startYear: sibling.lens.startYear, endYear: sibling.lens.endYear }
      : this.windowCenteredAt(chartEl, clientX);
    this.state.placeLens(key, { stage, startYear, endYear, linked: shift });
  }

  /**
   * Returns a lens window centered on the drop position (converted from client X to year),
   * clamped so neither boundary exits the chart's visible year domain.
   * Falls back to the domain center when `clientX` is null (sweep mode).
   */
  private windowCenteredAt(chartEl: HTMLElement, clientX: number | null): { startYear: number; endYear: number } {
    const domainStart = chartEl.dataset.yearStart ? Number(chartEl.dataset.yearStart) : 1950;
    const domainEnd = chartEl.dataset.yearEnd ? Number(chartEl.dataset.yearEnd) : 2024;
    const span = LENS_STAGE_WIDTH.default;
    const half = Math.round(span / 2);

    let dropYear: number;
    if (clientX !== null) {
      const svg = chartEl.querySelector<SVGSVGElement>('.emissions-chart__svg');
      const svgRect = svg?.getBoundingClientRect();
      if (svgRect) {
        const plotWidth = svgRect.width - CHART_MARGIN.left - CHART_MARGIN.right;
        const plotX = clientX - svgRect.left - CHART_MARGIN.left;
        const t = Math.max(0, Math.min(1, plotX / plotWidth));
        dropYear = Math.round(domainStart + t * (domainEnd - domainStart));
      } else {
        dropYear = Math.round((domainStart + domainEnd) / 2);
      }
    } else {
      dropYear = Math.round((domainStart + domainEnd) / 2);
    }

    const startYear = Math.max(domainStart, Math.min(domainEnd - span, dropYear - half));
    const endYear = startYear + span;
    return { startYear, endYear };
  }

  /**
   * Syncs stage icon visibility and remove button visibility.
   * Stage icons: shown only when available (LENS-03).
   * Remove buttons: shown only when lenses of that stage actually exist.
   */
  private syncStages(): void {
    const available = new Set(this.state.availableStages());
    const placed = new Set(this.state.allLenses().map(({ lens }) => lens.stage));
    for (const [stage, btn] of this.stageButtons) {
      btn.classList.toggle('lens-stage-icon--hidden', !available.has(stage));
    }
    for (const [stage, btn] of this.removeButtons) {
      btn.classList.toggle('lens-stage-panel__remove--hidden', !placed.has(stage));
    }
  }
}
