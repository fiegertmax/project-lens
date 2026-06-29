import { format, pointer } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { DataPoint } from '../data/types';

const VALUE_FMT = format(',.2f');

interface DotDatum {
  label: string;
  color: string;
  v: number;
  yScale: ScaleLinear<number, number>;
  format: (v: number) => string;
}

export interface CrosshairEntry {
  label: string;
  color: string;
  points: DataPoint[];
  /** Per-entry y scale for dot placement; falls back to the shared y (e.g. a GDP right axis). */
  yScale?: ScaleLinear<number, number>;
  /** Per-entry value formatter; falls back to the shared valueLabel. */
  format?: (v: number) => string;
}

/** Linear interpolation of a value at `year` from a sorted DataPoint array. */
function valueAt(points: DataPoint[], year: number): number | undefined {
  if (!points.length) return undefined;
  const idx = points.findIndex((p) => p.year >= year);
  if (idx === -1) return undefined;
  const right = points[idx];
  if (right.year === year || idx === 0) return Number.isFinite(right.value) ? right.value : undefined;
  const left = points[idx - 1];
  const t = (year - left.year) / (right.year - left.year);
  const v = left.value + t * (right.value - left.value);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Renders a vertical crosshair + per-series dots at the hovered year and a
 * floating value tooltip. Hides automatically when the cursor is over a line
 * drag hit path so line-dragging is never blocked.
 *
 * Call setData() on every chart update to keep scales and series current.
 * Call destroy() when the chart is removed to clean up the body-level tooltip div.
 */
export class CrosshairOverlay {
  private readonly plot: Selection<SVGGElement, unknown, null, undefined>;
  private readonly group: Selection<SVGGElement, unknown, null, undefined>;
  private readonly tooltip: HTMLDivElement;

  private x: ScaleLinear<number, number> | null = null;
  private y: ScaleLinear<number, number> | null = null;
  private innerH = 0;
  private entries: CrosshairEntry[] = [];
  private valueLabel: (v: number) => string = VALUE_FMT;
  private readonly onLensDragStart: () => void;

  constructor(
    svg: Selection<SVGSVGElement, unknown, null, undefined>,
    plot: Selection<SVGGElement, unknown, null, undefined>,
    /** CSS selector that matches the transparent drag hit paths (e.g. '.single-line-hit'). */
    hitPathSelector: string,
  ) {
    this.plot = plot;

    this.group = plot.append('g')
      .attr('class', 'crosshair')
      .attr('pointer-events', 'none')
      .style('display', 'none');

    this.group.append('line').attr('class', 'crosshair__vline');

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'crosshair-tooltip crosshair-tooltip--hidden';
    document.body.appendChild(this.tooltip);

    this.onLensDragStart = () => this.hide();
    window.addEventListener('lens-drag-start', this.onLensDragStart);

    svg.on('mousemove.crosshair', (event: MouseEvent) => {
      // Cursor is on a drag hit path, or any lens drag is in progress — hide the crosshair
      if (
        (event.target as Element).matches(hitPathSelector) ||
        document.body.classList.contains('lens-band-dragging') ||
        document.body.classList.contains('lens-dragging')
      ) {
        this.hide();
        return;
      }
      if (!this.x || !this.y) return;
      const [mx, my] = pointer(event, plot.node()!);
      const [xMin, xMax] = this.x.range();
      // Only show inside the actual plot area (not margins / axes)
      if (mx < xMin || mx > xMax || my < 0 || my > this.innerH) {
        this.hide();
        return;
      }
      this.show(mx, event.clientX, event.clientY);
    });

    svg.on('mouseleave.crosshair', () => this.hide());
  }

  /** Must be called on every chart update() so scales and series stay in sync. */
  setData(
    x: ScaleLinear<number, number>,
    y: ScaleLinear<number, number>,
    innerH: number,
    entries: CrosshairEntry[],
    valueLabel?: (v: number) => string,
  ): void {
    this.x = x;
    this.y = y;
    this.innerH = innerH;
    this.entries = entries;
    this.valueLabel = valueLabel ?? VALUE_FMT;
  }

  /** Remove the body-level tooltip div (call from chart.destroy()). */
  destroy(): void {
    window.removeEventListener('lens-drag-start', this.onLensDragStart);
    this.tooltip.remove();
  }

  hide(): void {
    this.group.style('display', 'none');
    this.tooltip.classList.add('crosshair-tooltip--hidden');
  }

  private show(mx: number, clientX: number, clientY: number): void {
    const x = this.x!;
    const y = this.y!;
    const year = Math.round(x.invert(mx));
    const px = x(year);

    // Re-append to the end of the plot group on every show so it always renders
    // above all other SVG groups (lens bands, lines, drag overlays, etc.)
    this.plot.node()!.appendChild(this.group.node()!);
    this.group.style('display', null);

    this.group.select<SVGLineElement>('line.crosshair__vline')
      .attr('x1', px).attr('y1', 0)
      .attr('x2', px).attr('y2', this.innerH);

    const dotData = this.entries
      .map((e) => ({
        label: e.label,
        color: e.color,
        v: valueAt(e.points, year),
        yScale: e.yScale ?? y,
        format: e.format ?? this.valueLabel,
      }))
      .filter((e): e is DotDatum => e.v !== undefined);

    this.group
      .selectAll<SVGCircleElement, DotDatum>('circle.crosshair__dot')
      .data(dotData, (d) => d.label)
      .join('circle')
      .attr('class', 'crosshair__dot')
      .attr('cx', px)
      .attr('cy', (d) => d.yScale(d.v))
      .attr('r', 4)
      .attr('fill', (d) => d.color)
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 1.5);

    this.buildTooltip(year, dotData, clientX, clientY);
    this.tooltip.classList.remove('crosshair-tooltip--hidden');
  }

  private buildTooltip(
    year: number,
    entries: DotDatum[],
    clientX: number,
    clientY: number,
  ): void {
    this.tooltip.textContent = '';

    const yearEl = document.createElement('div');
    yearEl.className = 'crosshair-tooltip__year';
    yearEl.textContent = String(year);
    this.tooltip.appendChild(yearEl);

    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'crosshair-tooltip__row';

      const swatch = document.createElement('span');
      swatch.className = 'crosshair-tooltip__swatch';
      swatch.style.background = e.color;

      const name = document.createElement('span');
      name.className = 'crosshair-tooltip__label';
      name.textContent = e.label;

      const val = document.createElement('span');
      val.className = 'crosshair-tooltip__value';
      val.textContent = e.format(e.v);

      row.append(swatch, name, val);
      this.tooltip.appendChild(row);
    }

    // Position to the right of the cursor; flip left when close to the right edge
    const tw = this.tooltip.offsetWidth || 160;
    const th = this.tooltip.offsetHeight || 40;
    const left = clientX + 16 + tw > window.innerWidth - 8
      ? clientX - tw - 12
      : clientX + 16;
    const top = Math.max(8, Math.min(clientY - th / 2, window.innerHeight - th - 8));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }
}
