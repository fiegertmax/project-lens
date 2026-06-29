import { LENS_WIDTH } from '../config';
import { CHART_MARGIN } from '../charts/EmissionsChart';
import type { CountryLensState } from '../state/CountryLensState';
import { Collapsible } from './Collapsible';
import { LENS_ICON } from './icons';
import { createLensDragSweeper } from './lens-drag-sweeper';
import { attachCursorTooltip } from './cursorTooltip';

/** Returns the emissions chart element under (x, y), if any. */
function lensDropTargetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>('.emissions-chart') ?? null;
}

/** Sidebar panel: a single lens icon to drag onto a chart, plus a remove button.
 *  The lens is shared across all charts, so placing/removing it here affects them all. */
export class LensPanel {
  readonly root: HTMLDivElement;

  private readonly state: CountryLensState;
  private removeButton!: HTMLButtonElement;

  constructor(parent: HTMLElement, state: CountryLensState) {
    this.state = state;
    const panel = new Collapsible(parent, 'Lens', 'lens-stage-panel');
    this.root = panel.root;

    this.buildIcon(panel.body);

    state.subscribe(() => this.sync());
    this.sync();
  }

  private buildIcon(parent: HTMLElement): void {
    const list = document.createElement('div');
    list.className = 'lens-stage-panel__list';

    const row = document.createElement('div');
    row.className = 'lens-stage-panel__row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lens-stage-icon';
    // innerHTML is safe here: LENS_ICON is a trusted static SVG constant, not user data
    btn.innerHTML = LENS_ICON;
    attachCursorTooltip(btn, `Drag onto a country chart to place the lens. It appears on every chart at the same time window and shows derived insights like rate of change or emissions per person.`);
    this.wireDrag(btn);

    this.removeButton = document.createElement('button');
    this.removeButton.type = 'button';
    this.removeButton.className = 'lens-stage-panel__remove';
    this.removeButton.textContent = 'Remove Lens';
    this.removeButton.addEventListener('click', () => this.state.clear());

    row.append(btn, this.removeButton);
    list.appendChild(row);
    parent.appendChild(list);
  }

  private wireDrag(btn: HTMLButtonElement): void {
    createLensDragSweeper<HTMLElement>(btn, {
      // Any chart is a valid drop target: GDP-less single countries fall back to the
      // driving-factors slope, so the lens is meaningful in every view and metric mode.
      resolveTarget: (x, y) => lensDropTargetAt(x, y),
      onHover: (target, previous) => {
        previous?.classList.remove('emissions-chart--drop');
        target?.classList.add('emissions-chart--drop');
      },
      onSweep: (target) => this.placeOn(target, null),
      onDrop: (target, { clientX }) => this.placeOn(target, clientX),
      // Always droppable: a single lens never overlaps anything.
      canDrop: () => true,
    });
  }

  private placeOn(chartEl: HTMLElement | null, clientX: number | null): void {
    if (!chartEl) return;
    const { startYear, endYear } = this.windowCenteredAt(chartEl, clientX);
    this.state.place({ startYear, endYear });
  }

  /**
   * Returns a lens window centered on the drop position (converted from client X to year),
   * clamped so neither boundary exits the chart's visible year domain.
   * Falls back to the domain center when `clientX` is null (sweep mode).
   */
  private windowCenteredAt(chartEl: HTMLElement, clientX: number | null): { startYear: number; endYear: number } {
    const domainStart = chartEl.dataset.yearStart ? Number(chartEl.dataset.yearStart) : 1950;
    const domainEnd = chartEl.dataset.yearEnd ? Number(chartEl.dataset.yearEnd) : 2024;
    const span = LENS_WIDTH.default;
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

  /** Shows the remove button only while a lens exists. */
  private sync(): void {
    this.removeButton.classList.toggle('lens-stage-panel__remove--hidden', this.state.get() === null);
  }
}
