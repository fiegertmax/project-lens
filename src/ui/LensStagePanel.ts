import { LENS_STAGE_WIDTH } from '../config';
import type { CountryLensState, LensStage } from '../state/CountryLensState';
import { COMBINED_CHART_KEY } from '../state/CountryLensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { createLensDragSweeper } from './lens-drag-sweeper';

/** The three stage numbers in display order. */
const STAGES: readonly LensStage[] = [1, 2, 3];

/** Returns the lens drop target under (x, y): a single-country chart OR the combined chart. */
function lensDropTargetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (
    el?.closest<HTMLElement>('.single-country-chart[data-country]') ??
    el?.closest<HTMLElement>('.combined-chart') ??
    null
  );
}

/** Sidebar panel: three progressively-revealed stage icons with paired remove buttons,
 *  and drag-to-place onto single-country charts. */
export class LensStagePanel {
  readonly root: HTMLDivElement;

  private readonly state: CountryLensState;
  private readonly stageButtons = new Map<LensStage, HTMLButtonElement>();
  private readonly removeButtons = new Map<LensStage, HTMLButtonElement>();

  constructor(parent: HTMLElement, state: CountryLensState) {
    this.state = state;
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
      btn.setAttribute('title', `Drag onto a country chart to place a stage-${stage} lens`);
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
      resolveTarget: (x, y) => lensDropTargetAt(x, y),
      onHover: (target, previous) => {
        previous?.classList.remove('single-country-chart--drop', 'combined-chart--drop');
        target?.classList.add(
          target.classList.contains('combined-chart')
            ? 'combined-chart--drop'
            : 'single-country-chart--drop',
        );
      },
      // Place on each chart swept over while Shift is held
      onSweep: (target) => this.placeOn(target, stage, true),
      onDrop: (target, { shift }) => this.placeOn(target, stage, shift),
    });
  }

  private placeOn(chartEl: HTMLElement | null, stage: LensStage, shift: boolean): void {
    if (!chartEl) return;
    const key = chartEl.dataset.country ?? COMBINED_CHART_KEY;
    // If a lens of this stage already exists elsewhere, inherit its boundaries so
    // the new lens starts in sync with its peers (drag/zoom moves all together).
    const sibling = this.state.allLenses().find(({ lens }) => lens.stage === stage);
    const { startYear, endYear } = sibling
      ? { startYear: sibling.lens.startYear, endYear: sibling.lens.endYear }
      : this.placementWindow(chartEl);
    this.state.placeLens(key, { stage, startYear, endYear, linked: shift });
  }

  /** Derives a placement window centered in the chart's visible year domain.
   *  Reads `data-year-start`/`data-year-end` if present; falls back to dataset midpoint. */
  private placementWindow(chartEl: HTMLElement): { startYear: number; endYear: number } {
    const rawStart = chartEl.dataset.yearStart;
    const rawEnd = chartEl.dataset.yearEnd;
    const domainStart = rawStart ? Number(rawStart) : 1950;
    const domainEnd = rawEnd ? Number(rawEnd) : 2024;
    const span = LENS_STAGE_WIDTH.default;
    const center = Math.round((domainStart + domainEnd) / 2);
    const half = Math.round(span / 2);
    return { startYear: center - half, endYear: center - half + span };
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
