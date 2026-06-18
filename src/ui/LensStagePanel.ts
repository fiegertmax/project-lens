import { LENS_STAGE_WIDTH } from '../config';
import type { CountryLensState, LensStage } from '../state/CountryLensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { createLensDragSweeper } from './lens-drag-sweeper';

/** The three stage numbers in display order. */
const STAGES: readonly LensStage[] = [1, 2, 3];

/** Single-country chart element under a viewport point, or null.
 *  Only matches `.single-country-chart[data-country]` — the combined chart is excluded (LENS-01). */
function singleCountryChartAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>('.single-country-chart[data-country]') ?? null;
}

/** Sidebar panel: three progressively-revealed stage icons (display:none gating), a
 *  placement-span slider, and drag-to-place onto single-country charts with Shift-linking. */
export class LensStagePanel {
  readonly root: HTMLDivElement;

  private readonly state: CountryLensState;
  private readonly stageButtons = new Map<LensStage, HTMLButtonElement>();
  /** Span in years used when placing a new lens. */
  private spanYears: number = LENS_STAGE_WIDTH.default;

  constructor(parent: HTMLElement, state: CountryLensState) {
    this.state = state;
    const panel = new Collapsible(parent, 'Lens', 'lens-stage-panel');
    this.root = panel.root;

    this.buildWidthControl(panel.body);
    this.buildStageIcons(panel.body);

    state.subscribe(() => this.syncStages());
    this.syncStages();
  }

  private buildWidthControl(parent: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.className = 'lens-stage-panel__width';

    const label = document.createElement('span');
    label.className = 'lens-stage-panel__width-label';
    label.textContent = `Width: ${this.spanYears} yrs`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(LENS_STAGE_WIDTH.min);
    slider.max = String(LENS_STAGE_WIDTH.max);
    slider.step = '1';
    slider.value = String(this.spanYears);
    slider.addEventListener('input', () => {
      this.spanYears = Number(slider.value);
      label.textContent = `Width: ${this.spanYears} yrs`;
    });

    wrap.append(label, slider);
    parent.appendChild(wrap);
  }

  private buildStageIcons(parent: HTMLElement): void {
    const iconRow = document.createElement('div');
    iconRow.className = 'lens-stage-panel__icons';

    for (const stage of STAGES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `lens-stage-icon lens-stage-icon--stage-${stage}`;
      // innerHTML is safe here: LENS_ICON is a trusted static SVG constant, not user data
      btn.innerHTML = LENS_ICON;
      btn.setAttribute('title', `Drag onto a country chart to place a stage-${stage} lens (hold Shift to link)`);
      this.stageButtons.set(stage, btn);
      this.wireDrag(btn, stage);
      iconRow.appendChild(btn);
    }

    parent.appendChild(iconRow);
  }

  private wireDrag(btn: HTMLButtonElement, stage: LensStage): void {
    createLensDragSweeper<HTMLElement>(btn, {
      resolveTarget: (x, y) => singleCountryChartAt(x, y),
      onHover: (target, previous) => {
        previous?.classList.remove('single-country-chart--drop');
        target?.classList.add('single-country-chart--drop');
      },
      onDrop: (target, { shift }) => this.placeOn(target, stage, shift),
    });
  }

  private placeOn(chartEl: HTMLElement | null, stage: LensStage, shift: boolean): void {
    const country = chartEl?.dataset.country;
    if (!country) return;

    const { startYear, endYear } = this.placementWindow(chartEl);

    this.state.placeLens(country, { stage, startYear, endYear, linked: shift });

    if (shift) {
      // Fan placement across every other visible single-country chart (LENSUI-03)
      const others = document.querySelectorAll<HTMLElement>('.single-country-chart[data-country]');
      for (const el of others) {
        if (el === chartEl) continue;
        const otherCountry = el.dataset.country;
        if (!otherCountry) continue;
        const win = this.placementWindow(el);
        this.state.placeLens(otherCountry, { stage, startYear: win.startYear, endYear: win.endYear, linked: true });
      }
    }
  }

  /** Derives a placement window centered in the chart's visible year domain.
   *  Reads `data-year-start`/`data-year-end` if present; falls back to dataset midpoint. */
  private placementWindow(chartEl: HTMLElement): { startYear: number; endYear: number } {
    const rawStart = chartEl.dataset.yearStart;
    const rawEnd = chartEl.dataset.yearEnd;
    const domainStart = rawStart ? Number(rawStart) : 1950;
    const domainEnd = rawEnd ? Number(rawEnd) : 2024;

    const center = Math.round((domainStart + domainEnd) / 2);
    const half = Math.round(this.spanYears / 2);
    return { startYear: center - half, endYear: center - half + this.spanYears };
  }

  /** Toggle `lens-stage-icon--hidden` on stage buttons based on availableStages().
   *  Stage 1 is always visible; stages 2/3 appear only when available (LENS-03, Success Criterion 2). */
  private syncStages(): void {
    const available = new Set(this.state.availableStages());
    for (const [stage, btn] of this.stageButtons) {
      btn.classList.toggle('lens-stage-icon--hidden', !available.has(stage));
    }
  }
}
