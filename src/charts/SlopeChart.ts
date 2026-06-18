import { axisBottom, axisLeft, format, line, scaleBand, scaleLinear, select } from 'd3';
import type { ScaleBand, ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { getSourceValue } from '../utils/getSourceValue';
import { boundaryYears, EMISSION_SOURCES } from './slope-types';
import type { LensWindow } from './slope-types';

const MARGIN = { top: 12, right: 110, bottom: 28, left: 72 };
const HEIGHT = 300;
const YEAR_FORMAT = format('d');
const MIN_LABEL_GAP = 12;

type BandScale = ScaleBand<number>;
type LinearScale = ScaleLinear<number, number>;
// SvgGroup: the top-level translated plot group (parent is null = document root via select())
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
// PlotLayer: child groups inside the plot (parent is SVGGElement)
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;

interface Point {
  i: number;
  year: number;
  value: number | undefined;
}

interface SourceEntry {
  key: string;
  label: string;
  color: string;
  points: Point[];
}


/**
 * Renders a slope chart for one country across a list of lens windows.
 * One colored line per emission source; scaleBand x-axis; single shared y-axis;
 * .defined() guard for broken lines at missing data (SLOPE-04);
 * consecutive lenses share boundary columns (SLOPE-05).
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

  /** Removes all rendered slope content (lines, axes, labels). */
  clear(): void {
    this.group('lines').selectAll('*').remove();
    this.group('labels').selectAll('*').remove();
    this.group('x-axis').selectAll('*').remove();
    this.group('y-axis').selectAll('*').remove();
  }

  render(country: string, lenses: LensWindow[]): void {
    if (lenses.length === 0) {
      this.clear();
      return;
    }

    const width = this.root.node()!.clientWidth || 600;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;

    this.svg.attr('width', width).attr('height', HEIGHT);

    // Build ordered column list — repeated shared boundaries for SLOPE-05
    const columns = boundaryYears(lenses);

    // Band scale indexed by column position (not year value) so repeated years get distinct slots
    const x: BandScale = scaleBand<number>()
      .domain(columns.map((_, i) => i))
      .range([0, innerW])
      .padding(0);

    // Center each point on its band
    const cx = (i: number): number => x(i)! + x.bandwidth() / 2;

    // Build per-source point arrays
    const sources: SourceEntry[] = EMISSION_SOURCES.map((src) => ({
      ...src,
      points: columns.map((year, i) => ({
        i,
        year,
        value: getSourceValue(this.dataset, country, src.key, year),
      })),
    }));

    // Shared y domain across all finite values from all sources
    const allValues = sources.flatMap((s) =>
      s.points.map((p) => p.value).filter((v): v is number => v !== undefined),
    );
    const yMin = allValues.length ? Math.min(0, Math.min(...allValues)) : 0;
    const yMax = allValues.length ? Math.max(...allValues) || 1 : 1;
    const y: LinearScale = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    this.renderAxes(x, y, columns, innerH);
    this.renderLines(sources, cx, y);
    this.renderLabels(sources, y, innerW);
  }

  private renderAxes(x: BandScale, y: LinearScale, columns: number[], innerH: number): void {
    // Bottom axis: one tick per column position, labeled with the boundary year
    const xAxis = axisBottom(x).tickFormat((i) => YEAR_FORMAT(columns[i as number]));
    this.group('x-axis')
      .attr('class', 'x-axis slope-chart__axis')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .selectAll<SVGTextElement, unknown>('.tick text')
      .attr('class', 'slope-chart__column-label');

    // Left axis: shared linear scale for all sources
    this.group('y-axis')
      .attr('class', 'y-axis slope-chart__axis')
      .call(axisLeft(y).ticks(5));
  }

  private renderLines(
    sources: SourceEntry[],
    cx: (i: number) => number,
    y: LinearScale,
  ): void {
    const lineGen = line<Point>()
      .defined((p) => p.value !== undefined)
      .x((p) => cx(p.i))
      .y((p) => y(p.value!));

    this.group('lines')
      .selectAll<SVGPathElement, SourceEntry>('path.slope-chart__line')
      .data(sources, (d) => d.key)
      .join('path')
      .attr('class', 'slope-chart__line')
      .attr('fill', 'none')
      .attr('stroke-width', 1.5)
      .attr('stroke', (d) => d.color)
      .attr('d', (d) => lineGen(d.points) ?? '');
  }

  private renderLabels(sources: SourceEntry[], y: LinearScale, innerW: number): void {
    // Only label sources that have at least one finite right-edge point
    const labeled = sources
      .map((src) => {
        const lastDefined = [...src.points].reverse().find((p) => p.value !== undefined);
        if (!lastDefined) return null;
        return { key: src.key, label: src.label, color: src.color, naturalY: y(lastDefined.value!) };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    // One-pass label-bump
    const bumped = this.bumpLabels(labeled.map((d) => ({ y: d.naturalY, minGap: MIN_LABEL_GAP })));

    this.group('labels')
      .selectAll<SVGTextElement, (typeof labeled)[number]>('text.slope-chart__label')
      .data(labeled, (d) => d.key)
      .join('text')
      .attr('class', 'slope-chart__label')
      .attr('x', innerW + 6)
      .attr('y', (_, i) => bumped[i])
      .attr('dy', '0.35em')
      .attr('font-size', '10px')
      .attr('fill', (d) => d.color)
      .text((d) => d.label);
  }

  /**
   * Single top-to-bottom pass: pushes each label down if it's closer than minGap
   * to the previous adjusted label. No iteration to convergence.
   */
  private bumpLabels(entries: { y: number; minGap: number }[]): number[] {
    if (entries.length === 0) return [];

    // Track original indices so we can map back after sorting
    const indexed = entries.map((e, i) => ({ ...e, originalIndex: i }));
    indexed.sort((a, b) => a.y - b.y);

    const adjusted = new Array<number>(entries.length);
    let prevAdjustedY = -Infinity;

    for (const item of indexed) {
      const bumped = Math.max(item.y, prevAdjustedY + item.minGap);
      adjusted[item.originalIndex] = bumped;
      prevAdjustedY = bumped;
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
