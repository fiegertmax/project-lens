import { drag, scaleLinear, select } from 'd3';
import type { D3DragEvent, ScaleLinear, Selection } from 'd3';
import type { CountryLensState, PlacedLens } from '../state/CountryLensState';
import { LENS_WIDTH, LENS_COLOR } from '../config';

// Mirrors the chart MARGIN (left 72, right 64) so live-drag re-measure width matches the rendered axes.
const BAND_MARGIN = { left: 72, right: 64 };

// Width of the invisible hit-area at each band edge that triggers resize dragging.
const EDGE_HANDLE_PX = 8;

export interface LensBandRenderOptions {
  /** The SVG g to render the band into. */
  plot: Selection<SVGGElement, unknown, null, undefined>;
  /** The single shared lens, or null when none is placed. */
  lens: PlacedLens | null;
  /** Year to pixel x scale. */
  x: ScaleLinear<number, number>;
  /** Visible domain, for clamping band edges. */
  yearRange: [number, number];
  /** Inner plot width in px. */
  innerW: number;
  /** Inner plot height in px. */
  innerH: number;
  lensState: CountryLensState;
  /** Live container width used during drag re-measurement. */
  getContainerWidth: () => number;
  /** Fired on drag-end and wheel-end so the caller can re-render slope/chart. */
  onChange?: () => void;
}

/**
 * Draws the single lens band, year labels, and remove button for any chart.
 * Attaches center x-drag (move), edge drag (resize), and Ctrl/Cmd+wheel (resize) handlers.
 * Because all charts share one lens in state, every gesture coordinates across them.
 */
export function renderLensBands(opts: LensBandRenderOptions): void {
  // Idempotent group creation.
  const bandGroup = opts.plot
    .selectAll<SVGGElement, null>('g.lens-band')
    .data([null])
    .join('g')
    .attr('class', 'lens-band');

  // Data-join over [lens] (or []) so the band cleanly appears/disappears with state.
  const lenses = opts.lens ? [opts.lens] : [];
  if (lenses.length === 0) {
    bandGroup.selectAll('*').remove();
    return;
  }

  const yearsPerPixel = (opts.yearRange[1] - opts.yearRange[0]) / opts.innerW;

  // The band rect — center drag moves the lens.
  bandGroup
    .selectAll<SVGRectElement, PlacedLens>('rect.placed-lens__rect')
    .data(lenses, (d) => d.id)
    .join('rect')
    .attr('class', 'placed-lens__rect')
    .attr('data-lens-id', (d) => d.id)
    .attr('x', (d) => opts.x(Math.max(opts.yearRange[0], d.startYear)))
    .attr('y', 0)
    .attr('width', (d) => {
      const bx = opts.x(Math.max(opts.yearRange[0], d.startYear));
      const ex = opts.x(Math.min(opts.yearRange[1], d.endYear));
      return Math.max(0, ex - bx);
    })
    .attr('height', opts.innerH)
    .attr('fill', LENS_COLOR)
    .attr('fill-opacity', 0.18)
    .attr('stroke', LENS_COLOR)
    .attr('stroke-width', 1.5)
    .attr('cursor', 'grab')
    .call(makeLensDragLocal(opts, yearsPerPixel))
    .on('wheel.lens', (ev: WheelEvent, d) => handleLensWheelLocal(ev, d, opts));

  // Year labels at band edges
  const labelData = lenses.flatMap((d) => [
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

  // Left edge handle — dragging resizes the start boundary.
  bandGroup
    .selectAll<SVGRectElement, PlacedLens>('rect.placed-lens__edge-left')
    .data(lenses, (d) => d.id)
    .join('rect')
    .attr('class', 'placed-lens__edge-left')
    .attr('data-lens-id', (d) => d.id)
    .attr('x', (d) => opts.x(Math.max(opts.yearRange[0], d.startYear)))
    .attr('y', 0)
    .attr('width', EDGE_HANDLE_PX)
    .attr('height', opts.innerH)
    .attr('fill', 'transparent')
    .attr('cursor', 'col-resize')
    .call(makeLeftEdgeDragLocal(opts, yearsPerPixel));

  // Right edge handle — dragging resizes the end boundary.
  bandGroup
    .selectAll<SVGRectElement, PlacedLens>('rect.placed-lens__edge-right')
    .data(lenses, (d) => d.id)
    .join('rect')
    .attr('class', 'placed-lens__edge-right')
    .attr('data-lens-id', (d) => d.id)
    .attr('x', (d) => opts.x(Math.min(opts.yearRange[1], d.endYear)) - EDGE_HANDLE_PX)
    .attr('y', 0)
    .attr('width', EDGE_HANDLE_PX)
    .attr('height', opts.innerH)
    .attr('fill', 'transparent')
    .attr('cursor', 'col-resize')
    .call(makeRightEdgeDragLocal(opts, yearsPerPixel));

  // Remove button: × at the top-right of the band — rendered last so it sits above edge handles.
  bandGroup
    .selectAll<SVGTextElement, PlacedLens>('text.placed-lens__remove')
    .data(lenses, (d) => d.id)
    .join('text')
    .attr('class', 'placed-lens__remove')
    .attr('x', (d) => opts.x(Math.min(opts.yearRange[1], d.endYear)) - 3)
    .attr('y', 14)
    .attr('text-anchor', 'end')
    .attr('font-size', '13px')
    .attr('fill', LENS_COLOR)
    .attr('cursor', 'pointer')
    .text('×')
    .on('click', (ev) => {
      ev.stopPropagation();
      opts.lensState.clear();
    });
}

/**
 * Returns a d3 drag behaviour that moves the shared lens.
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
    .on('drag', (ev: D3DragEvent<SVGRectElement, PlacedLens, unknown>) => {
      const delta = ev.dx * yearsPerPixel;
      opts.lensState.move(delta, opts.yearRange);
      // Update band position live for immediate visual feedback
      const updated = opts.lensState.get();
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

/** Drag handler for the left edge handle — moves startYear, endYear stays fixed. */
function makeLeftEdgeDragLocal(
  opts: LensBandRenderOptions,
  yearsPerPixel: number,
) {
  return drag<SVGRectElement, PlacedLens>()
    .on('start', () => {
      document.body.classList.add('lens-band-edge-resizing');
      window.dispatchEvent(new CustomEvent('lens-drag-start'));
    })
    .on('drag', (ev: D3DragEvent<SVGRectElement, PlacedLens, unknown>) => {
      const delta = ev.dx * yearsPerPixel;
      opts.lensState.resizeLeft(delta, opts.yearRange);
      liveUpdateBandRect(opts);
    })
    .on('end', () => {
      document.body.classList.remove('lens-band-edge-resizing');
      opts.onChange?.();
    });
}

/** Drag handler for the right edge handle — moves endYear, startYear stays fixed. */
function makeRightEdgeDragLocal(
  opts: LensBandRenderOptions,
  yearsPerPixel: number,
) {
  return drag<SVGRectElement, PlacedLens>()
    .on('start', () => {
      document.body.classList.add('lens-band-edge-resizing');
      window.dispatchEvent(new CustomEvent('lens-drag-start'));
    })
    .on('drag', (ev: D3DragEvent<SVGRectElement, PlacedLens, unknown>) => {
      const delta = ev.dx * yearsPerPixel;
      opts.lensState.resizeRight(delta, opts.yearRange);
      liveUpdateBandRect(opts);
    })
    .on('end', () => {
      document.body.classList.remove('lens-band-edge-resizing');
      opts.onChange?.();
    });
}

/** Re-positions the band rect and edge handles after a resize gesture. */
function liveUpdateBandRect(opts: LensBandRenderOptions): void {
  const updated = opts.lensState.get();
  if (!updated) return;

  const yr = opts.yearRange;
  const iW = opts.getContainerWidth() - BAND_MARGIN.left - BAND_MARGIN.right;
  const xScale = scaleLinear().domain(yr).range([0, iW]);
  const newX = xScale(Math.max(yr[0], updated.startYear));
  const newW = Math.max(0, xScale(Math.min(yr[1], updated.endYear)) - newX);

  opts.plot.select<SVGRectElement>(`g.lens-band rect.placed-lens__rect[data-lens-id="${updated.id}"]`)
    .attr('x', newX).attr('width', newW);
  opts.plot.select<SVGRectElement>(`g.lens-band rect.placed-lens__edge-left[data-lens-id="${updated.id}"]`)
    .attr('x', newX);
  opts.plot.select<SVGRectElement>(`g.lens-band rect.placed-lens__edge-right[data-lens-id="${updated.id}"]`)
    .attr('x', newX + newW - EDGE_HANDLE_PX);
}

/**
 * Handles Ctrl/Cmd+wheel over the lens band: resizes the lens (LENSUI-02).
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
  const newSpan = Math.max(LENS_WIDTH.min, currentSpan + step);
  opts.lensState.resize(newSpan, opts.yearRange);
  opts.onChange?.();
}
