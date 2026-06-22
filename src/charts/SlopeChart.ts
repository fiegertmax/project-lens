import { axisRight, format, scaleSymlog, select } from 'd3';
import type { ScaleSymLog, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { STAGE_COLORS } from '../config';
import { getSourceValue } from '../utils/getSourceValue';
import { EMISSION_SOURCES } from './slope-types';
import type { AggregatedLensWindow, StagedLensWindow } from './slope-types';

// Matches the line chart height; right margin reserves space for source labels + scale
const MARGIN = { top: 20, right: 110, bottom: 28, left: 10 };
const HEIGHT = 360;
// x offset (from right parallel axis) where the floating value scale begins
const SCALE_X = 65;
const MIN_LABEL_GAP = 12;
const YEAR_FORMAT = format('d');
const DELTA_FORMAT = format(',.2f');

type LogScale = ScaleSymLog<number, number>;
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;

interface SourceEntry {
  key: string;
  label: string;
  color: string;
  leftValue: number | undefined;
  rightValue: number | undefined;
}

/**
 * Parallel-coordinates panel for one lensed country.
 * N vertical axis lines (one per boundary year) with colored source lines per stage,
 * plus a decoupled value scale on the right.
 */
export class SlopeChart {
  private readonly dataset: EmissionsDataset;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;
  private readonly tooltip: HTMLDivElement;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;

    this.root = select(parent).append('div').attr('class', 'slope-chart');
    this.svg = this.root.append('svg').attr('class', 'slope-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'crosshair-tooltip crosshair-tooltip--hidden';
    document.body.appendChild(this.tooltip);
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.tooltip.remove();
    this.root.remove();
  }

  clear(): void {
    ['axes', 'lines', 'labels', 'y-scale'].forEach((name) =>
      this.group(name).selectAll('*').remove(),
    );
    this.hideTooltip();
    this.root.style('display', 'none');
  }

  /**
   * Renders one slope-line set per staged lens with per-source colors.
   * yDomain, when provided, pins the y-axis to the same domain as the line chart so
   * slopes are directly comparable to the values shown on the left axis (SLOPE-06).
   */
  render(
    country: string,
    lenses: StagedLensWindow[],
    yDomain?: [number, number],
    excludeSources?: ReadonlySet<string>,
  ): void {
    if (lenses.length === 0) {
      this.clear();
      return;
    }

    this.root.style('display', null);
    const width = this.root.node()!.clientWidth || 300;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    // Ordered boundary years: N+1 values for N lenses. Consecutive lenses share a column (SLOPE-05).
    const columns = this.columnPositions(lenses, innerW);

    // Collect all source entries across all lenses to build a shared y-axis.
    const allEntries: SourceEntry[][] = lenses.map((lens) => this.buildEntries(country, lens, excludeSources));

    // Use the caller-supplied domain (line chart's y-axis) when available so source slopes
    // are readable at the same scale as the main chart. Fall back to auto-fit from source values.
    let domainMin: number;
    let domainMax: number;
    if (yDomain) {
      [domainMin, domainMax] = yDomain;
    } else {
      const allValues = allEntries.flat().flatMap((s) =>
        [s.leftValue, s.rightValue].filter((v): v is number => v !== undefined),
      );
      domainMin = allValues.length ? Math.min(...allValues) : 0;
      domainMax = allValues.length ? Math.max(...allValues) || 1 : 1;
    }
    const y: LogScale = scaleSymlog().domain([domainMin, domainMax]).range([innerH, 0]);

    this.renderAxes(columns, lenses, innerH);
    this.renderAllLines(lenses, allEntries, columns, y);
    this.renderAllLabels(allEntries, columns, y, innerW);
    this.renderScale(y, innerW, innerH);
  }

  /**
   * Render path for pre-computed cross-country means. A separate method is needed because
   * values cannot be looked up from a single country — they are already aggregated by the
   * caller (crossCountryMean). Reuses all existing render helpers unchanged.
   */
  renderAggregated(lenses: AggregatedLensWindow[], yDomain?: [number, number]): void {
    if (lenses.length === 0) {
      this.clear();
      return;
    }

    this.root.style('display', null);
    const width = this.root.node()!.clientWidth || 300;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const columns = this.columnPositions(lenses, innerW);

    // Build SourceEntry[][] from pre-computed values instead of per-country getSourceValue calls.
    const allEntries: SourceEntry[][] = lenses.map((lens) =>
      EMISSION_SOURCES.map((src) => ({
        key: `${lens.stage}-${src.key}`,
        label: src.label,
        color: src.color,
        leftValue: lens.values.get(src.key)?.left,
        rightValue: lens.values.get(src.key)?.right,
      })),
    );

    let domainMin: number;
    let domainMax: number;
    if (yDomain) {
      [domainMin, domainMax] = yDomain;
    } else {
      const allValues = allEntries.flat().flatMap((s) =>
        [s.leftValue, s.rightValue].filter((v): v is number => v !== undefined),
      );
      domainMin = allValues.length ? Math.min(...allValues) : 0;
      domainMax = allValues.length ? Math.max(...allValues) || 1 : 1;
    }
    const y: LogScale = scaleSymlog().domain([domainMin, domainMax]).range([innerH, 0]);

    this.renderAxes(columns, lenses, innerH);
    this.renderAllLines(lenses, allEntries, columns, y);
    this.renderAllLabels(allEntries, columns, y, innerW);
    this.renderScale(y, innerW, innerH);
  }

  /**
   * Computes x positions for each boundary year column.
   * N lenses produce N+1 unique columns; shared boundaries (SLOPE-05) get one x position.
   */
  private columnPositions(lenses: StagedLensWindow[], innerW: number): Map<number, number> {
    // Collect unique years in order; consecutive lenses share a boundary.
    const uniqueYears: number[] = [];
    for (const lens of lenses) {
      if (!uniqueYears.length || uniqueYears[uniqueYears.length - 1] !== lens.startYear) {
        uniqueYears.push(lens.startYear);
      }
      uniqueYears.push(lens.endYear);
    }
    const map = new Map<number, number>();
    uniqueYears.forEach((year, i) => {
      map.set(year, (i / (uniqueYears.length - 1 || 1)) * innerW);
    });
    return map;
  }

  /** Builds the source entries for a single lens. Excluded sources produce undefined values. */
  private buildEntries(country: string, lens: StagedLensWindow, excludeSources?: ReadonlySet<string>): SourceEntry[] {
    return EMISSION_SOURCES.map((src) => ({
      key: `${lens.stage}-${src.key}`,
      label: src.label,
      color: src.color,
      leftValue: excludeSources?.has(src.key) ? undefined : getSourceValue(this.dataset, country, src.key, lens.startYear),
      rightValue: excludeSources?.has(src.key) ? undefined : getSourceValue(this.dataset, country, src.key, lens.endYear),
    }));
  }

  /** Renders vertical axis lines + year labels for each boundary column. */
  private renderAxes(
    columns: Map<number, number>,
    lenses: StagedLensWindow[],
    innerH: number,
  ): void {
    const g = this.group('axes');

    const xs = [...columns.values()];
    g.selectAll<SVGLineElement, number>('line.slope-chart__axis-line')
      .data(xs)
      .join('line')
      .attr('class', 'slope-chart__axis-line')
      .attr('x1', (d) => d)
      .attr('y1', 0)
      .attr('x2', (d) => d)
      .attr('y2', innerH);

    // Year labels: collect unique (year, x) pairs from lens boundaries.
    const labelData: { year: number; x: number }[] = [];
    for (const [year, x] of columns) {
      labelData.push({ year, x });
    }
    g.selectAll<SVGTextElement, { year: number; x: number }>('text.slope-chart__year-label')
      .data(labelData, (d) => String(d.year))
      .join('text')
      .attr('class', 'slope-chart__year-label')
      .attr('x', (d) => d.x)
      .attr('y', innerH + 16)
      .attr('text-anchor', 'middle')
      .text((d) => YEAR_FORMAT(d.year));

    // Stage color indicators: small tinted lines at top of each lens segment.
    const segmentData = lenses.map((lens) => ({
      x1: columns.get(lens.startYear)!,
      x2: columns.get(lens.endYear)!,
      color: STAGE_COLORS[lens.stage],
    }));
    g.selectAll<SVGLineElement, (typeof segmentData)[number]>('line.slope-chart__stage-bar')
      .data(segmentData)
      .join('line')
      .attr('class', 'slope-chart__stage-bar')
      .attr('x1', (d) => d.x1)
      .attr('y1', -8)
      .attr('x2', (d) => d.x2)
      .attr('y2', -8)
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 3);

    // Drop lens segments where axes already account for them.
    // Remove old content explicitly so stale entries from a prior render don't persist.
    const _ = lenses;
    void _;
  }

  /** Renders all per-stage line sets and inter-lens connectors into the shared 'lines' layer. */
  private renderAllLines(
    lenses: StagedLensWindow[],
    allEntries: SourceEntry[][],
    columns: Map<number, number>,
    y: LogScale,
  ): void {
    const g = this.group('lines');
    g.selectAll('*').remove();

    let anyDrawable = false;
    for (let i = 0; i < allEntries.length; i++) {
      // Look up x positions by year so non-adjacent lenses land in their own columns.
      const lx = columns.get(lenses[i].startYear);
      const rx = columns.get(lenses[i].endYear);
      if (lx === undefined || rx === undefined) continue;
      anyDrawable = this.renderStageLines(g, allEntries[i], y, lx, rx) || anyDrawable;
    }

    // Dashed connectors between the right edge of lens N and the left edge of lens N+1.
    for (let i = 0; i < lenses.length - 1; i++) {
      const x1 = columns.get(lenses[i].endYear);
      const x2 = columns.get(lenses[i + 1].startYear);
      // Skip when lenses share a boundary column (adjacent) — no gap to bridge.
      if (x1 === undefined || x2 === undefined || x1 === x2) continue;
      this.renderConnectorLines(g, allEntries[i], allEntries[i + 1], y, x1, x2);
    }

    // "No data" notice when nothing is drawable across all lenses.
    g.selectAll<SVGTextElement, string>('text.slope-chart__empty')
      .data(anyDrawable ? [] : ['No data for lens range'])
      .join('text')
      .attr('class', 'slope-chart__empty')
      .attr('x', 0)
      .attr('y', 0)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'var(--text-muted)')
      .text((d) => d);
  }

  /**
   * Draws dashed connector lines per source between the right endpoint of one lens
   * and the left endpoint of the next. Entries are matched by position (same EMISSION_SOURCES order).
   */
  private renderConnectorLines(
    g: PlotLayer,
    leftEntries: SourceEntry[],
    rightEntries: SourceEntry[],
    y: LogScale,
    x1: number,
    x2: number,
  ): void {
    for (let j = 0; j < leftEntries.length; j++) {
      const left = leftEntries[j];
      const right = rightEntries[j];
      if (left.rightValue === undefined || right.leftValue === undefined) continue;
      g.append('line')
        .attr('class', 'slope-chart__connector')
        .attr('x1', x1)
        .attr('y1', y(left.rightValue))
        .attr('x2', x2)
        .attr('y2', y(right.leftValue))
        .attr('stroke', left.color)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,3')
        .attr('opacity', 0.5);
    }
  }

  /**
   * Draws slope lines and endpoint dots for one lens segment. Returns true if any
   * source was drawable (has both left and right values), enabling the "no data" guard.
   */
  private renderStageLines(
    g: PlotLayer,
    entries: SourceEntry[],
    y: LogScale,
    lx: number,
    rx: number,
  ): boolean {
    const drawable = entries.filter(
      (s) => s.leftValue !== undefined && s.rightValue !== undefined,
    );

    // Each stage-source gets a unique class key so multiple stages don't clash.
    g.selectAll<SVGLineElement, SourceEntry>(`line.${cssKey(entries[0]?.key ?? 'l')}`)
      .data(drawable, (d) => d.key)
      .join('line')
      .attr('class', 'slope-chart__source-line')
      .attr('x1', lx)
      .attr('y1', (d) => y(d.leftValue!))
      .attr('x2', rx)
      .attr('y2', (d) => y(d.rightValue!))
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 2);

    // Wider transparent hit areas make individual slopes easy to hover.
    g.selectAll<SVGLineElement, SourceEntry>(`line.hit-${cssKey(entries[0]?.key ?? 'h')}`)
      .data(drawable, (d) => d.key)
      .join('line')
      .attr('class', 'slope-chart__hit')
      .attr('x1', lx)
      .attr('y1', (d) => y(d.leftValue!))
      .attr('x2', rx)
      .attr('y2', (d) => y(d.rightValue!))
      .attr('stroke', 'transparent')
      .attr('stroke-width', 12)
      .on('mouseover', (event: MouseEvent, d: SourceEntry) => {
        this.showTooltip(d, event.clientX, event.clientY);
      })
      .on('mousemove', (event: MouseEvent) => {
        this.positionTooltip(event.clientX, event.clientY);
      })
      .on('mouseout', () => this.hideTooltip());

    const dots = drawable.flatMap((s) => [
      { cx: lx, cy: y(s.leftValue!), color: s.color, id: s.key + '-L' },
      { cx: rx, cy: y(s.rightValue!), color: s.color, id: s.key + '-R' },
    ]);

    g.selectAll<SVGCircleElement, (typeof dots)[number]>(`circle.${cssKey(entries[0]?.key ?? 'd')}`)
      .data(dots, (d) => d.id)
      .join('circle')
      .attr('class', 'slope-chart__dot')
      .attr('cx', (d) => d.cx)
      .attr('cy', (d) => d.cy)
      .attr('r', 3)
      .attr('fill', (d) => d.color);

    return drawable.length > 0;
  }

  /**
   * Renders labels at the rightmost axis, bumped vertically to avoid overlaps.
   * Uses the last lens's right-axis values for labeling.
   */
  private renderAllLabels(
    allEntries: SourceEntry[][],
    columns: Map<number, number>,
    y: LogScale,
    innerW: number,
  ): void {
    const lastEntries = allEntries[allEntries.length - 1] ?? [];
    const labeled = lastEntries
      .filter((s) => s.rightValue !== undefined)
      .map((s) => ({
        key: s.key,
        label: this.shortLabel(s.label),
        color: s.color,
        naturalY: y(s.rightValue!),
      }));

    const bumped = this.bumpLabels(labeled.map((d) => ({ y: d.naturalY, minGap: MIN_LABEL_GAP })));
    const rightX = Math.max(...columns.values(), innerW);

    this.group('labels')
      .selectAll<SVGTextElement, (typeof labeled)[number]>('text.slope-chart__label')
      .data(labeled, (d) => d.key)
      .join('text')
      .attr('class', 'slope-chart__label')
      .attr('x', rightX + 4)
      .attr('y', (_, i) => bumped[i])
      .attr('dy', '0.35em')
      .attr('fill', (d) => d.color)
      .text((d) => d.label);
  }

  /** Floating value scale to the right of the parallel axes with a unit label. */
  private renderScale(y: LogScale, innerW: number, innerH: number): void {
    // Cast required: PlotLayer has a narrower datum type than the axis call expects.
    const g = this.group('y-scale').attr('transform', `translate(${innerW + SCALE_X}, 0)`) as unknown as SvgGroup;
    g.call(axisRight(y).ticks(5));

    // Unit label rotated vertically beside the scale ticks
    g.selectAll<SVGTextElement, string>('text.slope-chart__scale-title')
      .data(['million tonnes'])
      .join('text')
      .attr('class', 'slope-chart__scale-title')
      .attr('transform', `translate(36, ${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .text((d) => d);
  }

  /** Abbreviates labels that would overflow into the floating scale area. */
  private shortLabel(label: string): string {
    return label.length > 10 ? label.slice(0, 9) + '…' : label;
  }

  /** Single top-to-bottom pass that spreads overlapping labels downward. */
  private bumpLabels(entries: { y: number; minGap: number }[]): number[] {
    if (entries.length === 0) return [];
    const indexed = entries.map((e, i) => ({ ...e, originalIndex: i }));
    indexed.sort((a, b) => a.y - b.y);
    const adjusted = new Array<number>(entries.length);
    let prevY = -Infinity;
    for (const item of indexed) {
      const bumped = Math.max(item.y, prevY + item.minGap);
      adjusted[item.originalIndex] = bumped;
      prevY = bumped;
    }
    return adjusted;
  }

  private showTooltip(entry: SourceEntry, clientX: number, clientY: number): void {
    this.tooltip.textContent = '';

    const row = document.createElement('div');
    row.className = 'crosshair-tooltip__row';

    const swatch = document.createElement('span');
    swatch.className = 'crosshair-tooltip__swatch';
    swatch.style.background = entry.color;

    const name = document.createElement('span');
    name.className = 'crosshair-tooltip__label';
    name.textContent = entry.label;

    const left = entry.leftValue ?? 0;
    const right = entry.rightValue ?? 0;
    const delta = right - left;
    const sign = delta >= 0 ? '+' : '';
    const pct = left !== 0 ? ` (${sign}${((delta / Math.abs(left)) * 100).toFixed(1)}%)` : '';

    const val = document.createElement('span');
    val.className = 'crosshair-tooltip__value';
    val.textContent = `${sign}${DELTA_FORMAT(delta)} Mt${pct}`;

    row.append(swatch, name, val);
    this.tooltip.appendChild(row);

    this.positionTooltip(clientX, clientY);
    this.tooltip.classList.remove('crosshair-tooltip--hidden');
  }

  private positionTooltip(clientX: number, clientY: number): void {
    const tw = this.tooltip.offsetWidth || 160;
    const th = this.tooltip.offsetHeight || 40;
    const left = clientX + 16 + tw > window.innerWidth - 8
      ? clientX - tw - 12
      : clientX + 16;
    const top = Math.max(8, Math.min(clientY - th / 2, window.innerHeight - th - 8));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.tooltip.classList.add('crosshair-tooltip--hidden');
  }

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}

/** Converts a SourceEntry key to a valid CSS class fragment (no colons/dots/leading digits). */
function cssKey(key: string): string {
  const sanitized = key.replace(/[^a-z0-9-]/gi, '-');
  return /^\d/.test(sanitized) ? `s-${sanitized}` : sanitized;
}
