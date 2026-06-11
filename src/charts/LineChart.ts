import {
  axisBottom,
  axisLeft,
  axisRight,
  drag,
  extent,
  format,
  line,
  scaleLinear,
  select,
} from 'd3';
import type { D3DragEvent, ScaleLinear, Selection } from 'd3';
import type { DataPoint, MetricDefinition } from '../data/types';
import type { DerivedPoint } from '../lens/effects';
import type { YearRange } from '../state/AppState';
import type { LensCombineMode } from '../state/LensState';
import { ToggleSwitch } from '../ui/ToggleSwitch';

// right margin reserves room for the lens's secondary y-axis (no reflow on toggle)
const MARGIN = { top: 12, right: 64, bottom: 28, left: 72 };
const HEIGHT = 200;
const YEAR_FORMAT = format('d');

type LinearScale = ScaleLinear<number, number>;
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;

/** What the stack tells a chart to draw for the lens this render cycle.
 *  A non-null context means the lens is active on this country. */
export interface LensRenderContext {
  window: YearRange;
  derived: DerivedPoint[];
  /** Shared value domain across lensed countries; set unless mode is 'off'/single. */
  sharedDomain?: [number, number];
  label: string;
  unit: string;
  combine: LensCombineControl;
  onSetCenter(year: number): void;
  onResizeBy(deltaYears: number): void;
}

/** Header +/− toggle that lenses (or un-lenses) this country. */
export interface LensControl {
  isTarget: boolean;
  onToggle(): void;
}

/** Shared compare/accumulate/mean state driving the in-lens config panel. */
export interface LensCombineControl {
  mode: LensCombineMode;
  /** Whether the current effect may be summed (false for percentages). */
  accumulable: boolean;
  /** Inert until at least two countries are lensed. */
  disabled: boolean;
  onToggle(mode: Exclude<LensCombineMode, 'off'>): void;
}

/** The three exclusive combine modes, paired with their compact panel labels. */
const COMBINE_OPTIONS: { mode: Exclude<LensCombineMode, 'off'>; label: string }[] = [
  { mode: 'compare', label: 'compare' },
  { mode: 'accumulate', label: 'accumulate' },
  { mode: 'mean', label: 'mean' },
];

interface ChartGeometry {
  x: LinearScale;
  innerW: number;
  innerH: number;
}

/** Renders one country's time-series as a standalone, self-scaled line chart. */
export class LineChart {
  private readonly country: string;
  private readonly metric: MetricDefinition;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;
  private geometry?: ChartGeometry;
  /** Header lens toggle; its handler is rebound each render via setLensControl. */
  private readonly lensToggle: HTMLButtonElement;
  private onToggle: (() => void) | null = null;
  /** Active resize handler while the lens is on this chart; null otherwise. */
  private onLensResize: ((deltaYears: number) => void) | null = null;
  /** In-lens combine config: anchor, expander, count hint, and the three switches. */
  private readonly config: HTMLDivElement;
  private readonly configToggle: HTMLButtonElement;
  private readonly configHint: HTMLParagraphElement;
  private readonly combineSwitches: ToggleSwitch[];
  /** Local-only: which charts have their config panel open (not shared). */
  private configExpanded = false;
  /** Latest combine control; the switches read it on user interaction. */
  private combine: LensCombineControl | null = null;

  constructor(parent: HTMLElement, country: string, metric: MetricDefinition) {
    this.country = country;
    this.metric = metric;
    this.root = select(parent)
      .append('div')
      .attr('class', 'line-chart')
      .attr('data-country', country); // resolves drop targets for the lens drag
    this.lensToggle = this.buildHeader();
    this.svg = this.root.append('svg').attr('class', 'line-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
    [this.config, this.configToggle, this.configHint, this.combineSwitches] = this.buildConfig();
    this.svg.node()!.addEventListener('wheel', (e) => this.onWheel(e), {
      passive: false,
    });
  }

  /** Re-render for the current data and shared year domain. */
  update(points: DataPoint[], yearRange: YearRange): void {
    const width = this.root.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const x = scaleLinear().domain(yearRange).range([0, innerW]);
    const y = scaleLinear()
      .domain(this.valueDomain(points))
      .nice()
      .range([innerH, 0]);

    this.geometry = { x, innerW, innerH };
    this.renderAxes(x, y, innerH);
    this.renderLine(points, x, y);
    this.renderDots(points, x, y);
    this.renderEmptyNotice(points, innerW, innerH);
  }

  /** Draw (or clear) the lens overlay for this chart. Call after update. */
  applyLens(ctx: LensRenderContext | null): void {
    if (!this.geometry) return;
    this.onLensResize = ctx ? ctx.onResizeBy : null;
    this.root.classed('line-chart--lensed', ctx !== null); // dims base line behind the lens
    this.renderActiveLens(ctx);
    this.renderConfig(ctx);
  }

  /** Position and sync the in-lens combine panel (hidden when not a target). */
  private renderConfig(ctx: LensRenderContext | null): void {
    this.config.classList.toggle('lens-config--hidden', ctx === null);
    if (!ctx) {
      this.combine = null;
      return;
    }
    this.combine = ctx.combine;

    const { x } = this.geometry!;
    const rootBox = this.root.node()!.getBoundingClientRect();
    const svgBox = this.svg.node()!.getBoundingClientRect();
    this.config.style.left = `${svgBox.left - rootBox.left + MARGIN.left + x(ctx.window[0])}px`;
    this.config.style.top = `${svgBox.top - rootBox.top + MARGIN.top}px`;

    // Hint disappears as soon as a second country enables the switches.
    this.configHint.classList.toggle('lens-config__hint--hidden', !ctx.combine.disabled);

    for (const [i, { mode, label }] of COMBINE_OPTIONS.entries())
      this.combineSwitches[i].set({
        checked: ctx.combine.mode === mode,
        disabled: ctx.combine.disabled || (mode === 'accumulate' && !ctx.combine.accumulable),
        label,
      });
    this.syncConfigCollapsed();
  }

  private syncConfigCollapsed(): void {
    this.config.classList.toggle('lens-config--collapsed', !this.configExpanded);
    this.configToggle.textContent = this.configExpanded ? '−' : '+';
  }

  /** Show/update the header lens toggle; null hides it (lens not applied). */
  setLensControl(control: LensControl | null): void {
    this.onToggle = control?.onToggle ?? null;
    const target = control?.isTarget ?? false;
    this.lensToggle.classList.toggle('line-chart__lens-toggle--hidden', !control);
    this.lensToggle.classList.toggle('line-chart__lens-toggle--on', target);
    this.lensToggle.textContent = target ? '−' : '+';
    this.lensToggle.title = target
      ? `Remove lens from ${this.country}`
      : `Apply lens to ${this.country}`;
  }

  /** Title row: name preceded by a +/− lens toggle (hidden until applied). */
  private buildHeader(): HTMLButtonElement {
    const title = this.root.append('h3').attr('class', 'line-chart__title');
    const toggle = title
      .append('button')
      .attr('type', 'button')
      .attr('class', 'line-chart__lens-toggle line-chart__lens-toggle--hidden')
      .on('click', () => this.onToggle?.());
    title.append('span').attr('class', 'line-chart__title-name').text(this.country);
    return toggle.node()!;
  }

  /** Build the (initially hidden) in-lens combine panel: anchor, +/− expander,
   *  a hint shown while too few countries are lensed, and the switches. */
  private buildConfig(): [HTMLDivElement, HTMLButtonElement, HTMLParagraphElement, ToggleSwitch[]] {
    const anchor = document.createElement('div');
    anchor.className = 'lens-config lens-config--hidden lens-config--collapsed';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'lens-config__toggle';
    toggle.title = 'Combine options';
    toggle.addEventListener('click', () => {
      this.configExpanded = !this.configExpanded;
      this.syncConfigCollapsed();
    });

    const panel = document.createElement('div');
    panel.className = 'lens-config__panel';

    const hint = document.createElement('p');
    hint.className = 'lens-config__hint';
    hint.textContent = 'Lens a second country to combine them.';
    panel.appendChild(hint);

    const switches = COMBINE_OPTIONS.map(({ mode }) => {
      const sw = new ToggleSwitch(panel, true);
      sw.onChange(() => this.combine?.onToggle(mode));
      return sw;
    });

    anchor.append(toggle, panel);
    this.root.node()!.appendChild(anchor);
    return [anchor, toggle, hint, switches];
  }

  /** Root element, used by the stack to enforce display order. */
  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.root.remove();
  }

  private valueDomain(points: DataPoint[]): [number, number] {
    const [min, max] = extent(points, (p) => p.value);
    if (min === undefined || max === undefined) return [0, 1];
    return min === max ? [0, max || 1] : [Math.min(0, min), max];
  }

  private renderAxes(x: LinearScale, y: LinearScale, innerH: number): void {
    this.group('x-axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(axisBottom(x).ticks(8).tickFormat((d) => YEAR_FORMAT(Number(d))));
    this.group('y-axis').call(axisLeft(y).ticks(5));
    this.renderYTitle(innerH);
  }

  /** Rotated label naming the variable shown on the y-axis. */
  private renderYTitle(innerH: number): void {
    this.group('y-title')
      .selectAll<SVGTextElement, string>('text')
      .data([`${this.metric.label} (${this.metric.unit})`])
      .join('text')
      .attr('class', 'line-chart__y-title')
      .attr('transform', `translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .text((d) => d);
  }

  private renderLine(points: DataPoint[], x: LinearScale, y: LinearScale): void {
    const path = line<DataPoint>()
      .x((p) => x(p.year))
      .y((p) => y(p.value));
    this.group('series')
      .selectAll<SVGPathElement, DataPoint[]>('path')
      .data(points.length ? [points] : [])
      .join('path')
      .attr('class', 'line-chart__line')
      .attr('d', (d) => path(d));
  }

  private renderDots(points: DataPoint[], x: LinearScale, y: LinearScale): void {
    const dots = this.group('dots')
      .selectAll<SVGCircleElement, DataPoint>('circle')
      .data(points, (d) => (d as DataPoint).year)
      .join('circle')
      .attr('class', (d) =>
        d.isMissing ? 'line-chart__dot line-chart__dot--missing' : 'line-chart__dot',
      )
      .attr('cx', (d) => x(d.year))
      .attr('cy', (d) => y(d.value))
      .attr('r', 2.5);

    dots
      .selectAll<SVGTitleElement, DataPoint>('title')
      .data((d) => [d])
      .join('title')
      .text((d) => this.tooltip(d));

    this.renderMissingLabels(points, x, y);
  }

  /** Year numbers under interpolated points, so gaps are visibly flagged. */
  private renderMissingLabels(
    points: DataPoint[],
    x: LinearScale,
    y: LinearScale,
  ): void {
    this.group('missing-labels')
      .selectAll<SVGTextElement, DataPoint>('text')
      .data(points.filter((p) => p.isMissing), (d) => (d as DataPoint).year)
      .join('text')
      .attr('class', 'line-chart__missing-label')
      .attr('x', (d) => x(d.year))
      .attr('y', (d) => y(d.value) - 8)
      .attr('text-anchor', 'middle')
      .text((d) => YEAR_FORMAT(d.year));
  }

  private renderEmptyNotice(
    points: DataPoint[],
    innerW: number,
    innerH: number,
  ): void {
    this.group('empty')
      .selectAll<SVGTextElement, number>('text')
      .data(points.length ? [] : [0])
      .join('text')
      .attr('class', 'line-chart__empty')
      .attr('x', innerW / 2)
      .attr('y', innerH / 2)
      .attr('text-anchor', 'middle')
      .text('No data in range');
  }

  private tooltip(point: DataPoint): string {
    const value = point.value.toLocaleString();
    const note = point.isMissing ? ' (interpolated)' : '';
    return `${point.year}: ${value} ${this.metric.unit}${note}`;
  }

  /** The draggable, resizable lens band, its derived line + right-hand axis. */
  private renderActiveLens(ctx: LensRenderContext | null): void {
    const { x, innerH } = this.geometry!;
    const layer = this.group('lens-active');
    const data = ctx ? [ctx] : [];

    layer
      .selectAll<SVGRectElement, LensRenderContext>('rect.lens-band')
      .data(data)
      .join('rect')
      .attr('class', 'lens-band')
      .attr('x', (d) => x(d.window[0]))
      .attr('y', 0)
      .attr('width', (d) => x(d.window[1]) - x(d.window[0]))
      .attr('height', innerH)
      .call(this.dragBand());

    // one scale drives both the derived line and the secondary axis that reads it
    const scale = ctx ? this.lensScale(ctx, innerH) : null;
    this.renderLensLine(layer, scale ? data : [], scale);
    this.renderLensAxis(scale ? ctx : null, scale);
  }

  /** Right-hand y-axis labelling the lens's derived series (weather-diagram style). */
  private renderLensAxis(ctx: LensRenderContext | null, scale: LinearScale | null): void {
    const { innerW, innerH } = this.geometry!;
    const axis = this.group('lens-axis').attr('transform', `translate(${innerW},0)`);
    if (!ctx || !scale) {
      axis.selectAll('*').remove();
      return;
    }
    axis.call(axisRight(scale).ticks(5));
    axis
      .selectAll<SVGTextElement, string>('text.lens-axis__title')
      .data([`${ctx.label} (${ctx.unit})`])
      .join('text')
      .attr('class', 'lens-axis__title')
      .attr('transform', `translate(${MARGIN.right - 16},${innerH / 2}) rotate(90)`)
      .attr('text-anchor', 'middle')
      .text((d) => d);
  }

  private renderLensLine(
    layer: PlotLayer,
    data: LensRenderContext[],
    scale: LinearScale | null,
  ): void {
    const { x } = this.geometry!;
    layer
      .selectAll<SVGPathElement, LensRenderContext>('path.lens-line')
      .data(data.filter((d) => d.derived.length > 0))
      .join('path')
      .attr('class', 'lens-line')
      .attr('d', (d) =>
        line<DerivedPoint>()
          .x((p) => x(p.year))
          .y((p) => scale!(p.value))(d.derived),
      );
  }

  /** Value scale for the derived series, or null when there's nothing to draw. */
  private lensScale(ctx: LensRenderContext, innerH: number): LinearScale | null {
    if (ctx.derived.length === 0) return null;
    const domain = ctx.sharedDomain ?? this.derivedDomain(ctx.derived);
    return scaleLinear().domain(domain).nice().range([innerH, 0]);
  }

  private dragBand() {
    return drag<SVGRectElement, LensRenderContext>()
      .container(() => this.plot.node()!)
      .on('drag', (event: D3DragEvent<SVGRectElement, LensRenderContext, unknown>, d) =>
        d.onSetCenter(this.geometry!.x.invert(event.x)),
      );
  }

  private derivedDomain(derived: DerivedPoint[]): [number, number] {
    const [min, max] = extent(derived, (d) => d.value);
    if (min === undefined || max === undefined) return [0, 1];
    const lo = Math.min(0, min);
    const hi = Math.max(0, max);
    return lo === hi ? [lo, hi + 1] : [lo, hi];
  }

  /** Ctrl/⌘ + wheel (and trackpad pinch) resizes the active lens. */
  private onWheel(event: WheelEvent): void {
    if (!this.onLensResize || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    this.onLensResize(event.deltaY > 0 ? -1 : 1);
  }

  /** Idempotently fetch (or create) a named plot layer group. */
  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
