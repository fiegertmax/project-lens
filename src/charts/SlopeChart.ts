import { axisRight, format, scaleLinear, select } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { getSourceValue } from '../utils/getSourceValue';
import { EMISSION_SOURCES } from './slope-types';
import type { LensWindow } from './slope-types';

// Matches the line chart height; right margin reserves space for source labels + scale
const MARGIN = { top: 20, right: 110, bottom: 28, left: 10 };
const HEIGHT = 360;
// x offset (from right parallel axis) where the floating value scale begins
const SCALE_X = 65;
const MIN_LABEL_GAP = 12;
const YEAR_FORMAT = format('d');

type LinearScale = ScaleLinear<number, number>;
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
 * Two vertical axis lines (one per lens boundary year) with colored source
 * lines connecting them, plus a decoupled value scale on the right.
 */
export class SlopeChart {
  private readonly dataset: EmissionsDataset;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;

    this.root = select(parent).append('div').attr('class', 'slope-chart');
    this.svg = this.root.append('svg').attr('class', 'slope-chart__svg');
    this.plot = this.svg
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.root.remove();
  }

  clear(): void {
    ['axes', 'lines', 'labels', 'y-scale'].forEach((name) =>
      this.group(name).selectAll('*').remove(),
    );
  }

  render(country: string, lenses: LensWindow[]): void {
    if (lenses.length === 0) {
      this.clear();
      return;
    }

    const width = this.root.node()!.clientWidth || 300;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    const { startYear, endYear } = lenses[0];

    const sources: SourceEntry[] = EMISSION_SOURCES.map((src) => ({
      key: src.key,
      label: src.label,
      color: src.color,
      leftValue: getSourceValue(this.dataset, country, src.key, startYear),
      rightValue: getSourceValue(this.dataset, country, src.key, endYear),
    }));

    const allValues = sources.flatMap((s) =>
      [s.leftValue, s.rightValue].filter((v): v is number => v !== undefined),
    );
    const yMin = allValues.length ? Math.min(0, Math.min(...allValues)) : 0;
    const yMax = allValues.length ? Math.max(...allValues) || 1 : 1;
    const y: LinearScale = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    this.renderAxes(innerW, innerH, startYear, endYear);
    this.renderLines(sources, y, innerW, innerH);
    this.renderLabels(sources, y, innerW);
    this.renderScale(y, innerW, innerH);
  }

  /** Two vertical axis lines with boundary-year labels at the bottom. */
  private renderAxes(innerW: number, innerH: number, startYear: number, endYear: number): void {
    const g = this.group('axes');

    g.selectAll<SVGLineElement, [number, number]>('line.slope-chart__axis-line')
      .data([[0, 0], [innerW, innerW]] as [number, number][])
      .join('line')
      .attr('class', 'slope-chart__axis-line')
      .attr('x1', (d) => d[0])
      .attr('y1', 0)
      .attr('x2', (d) => d[1])
      .attr('y2', innerH);

    g.selectAll<SVGTextElement, [number, number]>('text.slope-chart__year-label')
      .data([[0, startYear], [innerW, endYear]] as [number, number][])
      .join('text')
      .attr('class', 'slope-chart__year-label')
      .attr('x', (d) => d[0])
      .attr('y', innerH + 16)
      .attr('text-anchor', 'middle')
      .text((d) => YEAR_FORMAT(d[1]));
  }

  /** Colored lines (and endpoint dots) connecting left-axis value to right-axis value. */
  private renderLines(
    sources: SourceEntry[],
    y: LinearScale,
    innerW: number,
    innerH: number,
  ): void {
    const g = this.group('lines');
    const drawable = sources.filter(
      (s) => s.leftValue !== undefined && s.rightValue !== undefined,
    );

    g.selectAll<SVGLineElement, SourceEntry>('line.slope-chart__source-line')
      .data(drawable, (d) => d.key)
      .join('line')
      .attr('class', 'slope-chart__source-line')
      .attr('x1', 0)
      .attr('y1', (d) => y(d.leftValue!))
      .attr('x2', innerW)
      .attr('y2', (d) => y(d.rightValue!))
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 2);

    // Small dots at each axis to anchor the lines visually
    const dots = drawable.flatMap((s) => [
      { x: 0, cy: y(s.leftValue!), color: s.color, id: s.key + '-L' },
      { x: innerW, cy: y(s.rightValue!), color: s.color, id: s.key + '-R' },
    ]);

    g.selectAll<SVGCircleElement, (typeof dots)[number]>('circle.slope-chart__dot')
      .data(dots, (d) => d.id)
      .join('circle')
      .attr('class', 'slope-chart__dot')
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.cy)
      .attr('r', 3)
      .attr('fill', (d) => d.color);

    // "No data" notice when nothing is drawable
    g.selectAll<SVGTextElement, number>('text.slope-chart__empty')
      .data(drawable.length === 0 ? [innerH / 2] : [])
      .join('text')
      .attr('class', 'slope-chart__empty')
      .attr('x', innerW / 2)
      .attr('y', (d) => d)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', 'var(--text-muted)')
      .text('No data for lens range');
  }

  /** Source name labels just right of the right parallel axis (bumped vertically). */
  private renderLabels(sources: SourceEntry[], y: LinearScale, innerW: number): void {
    const labeled = sources
      .filter((s) => s.rightValue !== undefined)
      .map((s) => ({
        key: s.key,
        label: this.shortLabel(s.label),
        color: s.color,
        naturalY: y(s.rightValue!),
      }));

    const bumped = this.bumpLabels(labeled.map((d) => ({ y: d.naturalY, minGap: MIN_LABEL_GAP })));

    this.group('labels')
      .selectAll<SVGTextElement, (typeof labeled)[number]>('text.slope-chart__label')
      .data(labeled, (d) => d.key)
      .join('text')
      .attr('class', 'slope-chart__label')
      .attr('x', innerW + 4)
      .attr('y', (_, i) => bumped[i])
      .attr('dy', '0.35em')
      .attr('fill', (d) => d.color)
      .text((d) => d.label);
  }

  /** Floating value scale to the right of the parallel axes with a unit label. */
  private renderScale(y: LinearScale, innerW: number, innerH: number): void {
    const g = this.group('y-scale').attr('transform', `translate(${innerW + SCALE_X}, 0)`);
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

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
