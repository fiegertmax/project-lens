import { drag, scaleLinear, select } from 'd3';
import type { D3DragEvent, ScaleLinear, Selection } from 'd3';
import type { CountryLensState, PlacedLens } from '../state/CountryLensState';
import { LENS_STAGE_WIDTH, STAGE_COLORS } from '../config';
import type { LensSync } from './LensSync';

// Mirrors the chart MARGIN (left 72, right 64) so live-drag re-measure width matches the rendered axes.
const BAND_MARGIN = { left: 72, right: 64 };

export interface LensBandRenderOptions {
  /** The SVG g to render bands into. */
  plot: Selection<SVGGElement, unknown, null, undefined>;
  /** Caller passes lensState.lensesFor(key). */
  lenses: PlacedLens[];
  /** Year to pixel x scale. */
  x: ScaleLinear<number, number>;
  /** Visible domain, for clamping band edges. */
  yearRange: [number, number];
  /** Inner plot width in px. */
  innerW: number;
  /** Inner plot height in px. */
  innerH: number;
  /** Country name or COMBINED_CHART_KEY — identifies which lens set to mutate. */
  key: string;
  lensState: CountryLensState;
  lensSync: LensSync;
  /** Live container width used during drag re-measurement. */
  getContainerWidth: () => number;
  /** Fired on drag-end and wheel-end so the caller can re-render slope/chart. */
  onChange?: () => void;
}

/**
 * Draws stage-colored lens bands, year labels, and remove buttons for any chart key.
 * Attaches x-drag (move) and Ctrl/Cmd+wheel (resize) handlers via LensSync.
 * Key-parameterized so it works for both single-country charts and the combined chart.
 */
export function renderLensBands(opts: LensBandRenderOptions): void {
  // Idempotent group creation.
  const bandGroup = opts.plot
    .selectAll<SVGGElement, null>('g.lens-band')
    .data([null])
    .join('g')
    .attr('class', 'lens-band');

  if (opts.lenses.length === 0) {
    bandGroup.selectAll('*').remove();
    return;
  }

  const yearsPerPixel = (opts.yearRange[1] - opts.yearRange[0]) / opts.innerW;

  // One rect per placed lens, keyed by id
  bandGroup
    .selectAll<SVGRectElement, PlacedLens>('rect.placed-lens__rect')
    .data(opts.lenses, (d) => d.id)
    .join('rect')
    .attr('class', 'placed-lens__rect')
    .attr('x', (d) => opts.x(Math.max(opts.yearRange[0], d.startYear)))
    .attr('y', 0)
    .attr('width', (d) => {
      const bx = opts.x(Math.max(opts.yearRange[0], d.startYear));
      const ex = opts.x(Math.min(opts.yearRange[1], d.endYear));
      return Math.max(0, ex - bx);
    })
    .attr('height', opts.innerH)
    .attr('fill', (d) => STAGE_COLORS[d.stage])
    .attr('fill-opacity', 0.18)
    .attr('stroke', (d) => STAGE_COLORS[d.stage])
    .attr('stroke-width', 1.5)
    .attr('cursor', 'ew-resize')
    .call(makeLensDragLocal(opts, yearsPerPixel))
    .on('wheel.lens', (ev: WheelEvent, d) => handleLensWheelLocal(ev, d, opts));

  // Year labels at band edges
  const labelData = opts.lenses.flatMap((d) => [
    { x: opts.x(Math.max(opts.yearRange[0], d.startYear)), year: d.startYear, anchor: 'start' as const },
    { x: opts.x(Math.min(opts.yearRange[1], d.endYear)), year: d.endYear, anchor: 'end' as const },
  ]);

  bandGroup
    .selectAll<SVGTextElement, (typeof labelData)[number]>('text.placed-lens__label')
    .data(labelData, (d) => `${d.year}-${d.anchor}`)
    .join('text')
    .attr('class', 'placed-lens__label')
    .attr('x', (d) => d.x)
    .attr('y', -3)
    .attr('text-anchor', (d) => d.anchor)
    .text((d) => String(d.year));

  // Remove button: × at the top-right of each band
  bandGroup
    .selectAll<SVGTextElement, PlacedLens>('text.placed-lens__remove')
    .data(opts.lenses, (d) => d.id)
    .join('text')
    .attr('class', 'placed-lens__remove')
    .attr('x', (d) => opts.x(Math.min(opts.yearRange[1], d.endYear)) - 3)
    .attr('y', 14)
    .attr('text-anchor', 'end')
    .attr('font-size', '13px')
    .attr('fill', (d) => STAGE_COLORS[d.stage])
    .attr('cursor', 'pointer')
    .text('×')
    .on('click', (ev, d) => {
      ev.stopPropagation();
      opts.lensState.removeLens(opts.key, d.id);
    });
}

/**
 * Returns a d3 drag behaviour that moves the dragged lens via LensSync.
 * Live position update happens on 'drag'; onChange fires on 'end' for slope re-render.
 */
function makeLensDragLocal(
  opts: LensBandRenderOptions,
  yearsPerPixel: number,
) {
  return drag<SVGRectElement, PlacedLens>()
    .on('start', () => {
      document.body.classList.add('lens-band-dragging');
      window.dispatchEvent(new CustomEvent('lens-drag-start'));
    })
    .on('drag', (ev: D3DragEvent<SVGRectElement, PlacedLens, unknown>, d) => {
      const delta = ev.dx * yearsPerPixel;
      opts.lensSync.moveLinkedLens(opts.key, d.id, delta, opts.yearRange);
      // Update band position live for immediate visual feedback
      const updatedLenses = opts.lensState.lensesFor(opts.key);
      const updated = updatedLenses.find((l) => l.id === d.id);
      if (updated) {
        const rect = ev.sourceEvent.target as SVGRectElement;
        const yr = opts.yearRange;
        const w = opts.getContainerWidth();
        const iW = w - BAND_MARGIN.left - BAND_MARGIN.right;
        const xScale = scaleLinear().domain(yr).range([0, iW]);
        select(rect)
          .attr('x', xScale(Math.max(yr[0], updated.startYear)))
          .attr('width', Math.max(0, xScale(Math.min(yr[1], updated.endYear)) - xScale(Math.max(yr[0], updated.startYear))));
      }
    })
    .on('end', () => {
      document.body.classList.remove('lens-band-dragging');
      opts.onChange?.();
    });
}

/**
 * Handles Ctrl/Cmd+wheel over a lens band: resizes the lens via LensSync (LENSUI-02).
 * Normal scroll is untouched (T-05-02 threat mitigated).
 */
function handleLensWheelLocal(
  ev: WheelEvent,
  lens: PlacedLens,
  opts: LensBandRenderOptions,
): void {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();

  const currentSpan = lens.endYear - lens.startYear;
  // deltaY > 0 = scroll down = shrink; < 0 = scroll up = grow
  const step = ev.deltaY > 0 ? -1 : 1;
  const newSpan = Math.min(
    LENS_STAGE_WIDTH.max,
    Math.max(LENS_STAGE_WIDTH.min, currentSpan + step),
  );
  opts.lensSync.resizeLinkedLens(opts.key, lens.id, newSpan, opts.yearRange);
  opts.onChange?.();
}
