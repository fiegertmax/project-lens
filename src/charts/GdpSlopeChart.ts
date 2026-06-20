import { axisLeft, format, line, scaleLinear, select } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { STAGE_COLORS } from '../config';
import { getGdpPerCapita } from '../utils/getGdpPerCapita';
import type { PlacedLens } from '../state/CountryLensState';

const MARGIN = { top: 20, right: 56, bottom: 28, left: 44 };
const HEIGHT = 360;
const YEAR_FMT = format('d');
const CO2_FMT = format('.2~f');
const GDP_FMT = format(',.0f');
const CO2_COLOR = '#c0392b';
const GDP_COLOR = '#2e86c1';

type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;
type YScale = ScaleLinear<number, number>;

interface MetricPoint {
  x: number;
  y: number | undefined;
}

interface RawValues {
  co2: number | undefined;
  gdp: number | undefined;
}

/** Standalone two-line normalized [0,1] slope chart for per-capita mode (GDP-02). Does NOT extend SlopeChart. */
export class GdpSlopeChart {
  private readonly dataset: EmissionsDataset;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;
    this.root = select(parent).append('div').attr('class', 'gdp-slope-chart');
    this.svg = this.root.append('svg').attr('class', 'gdp-slope-chart__svg');
    this.plot = this.svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.root.remove();
  }

  clear(): void {
    ['axes', 'lines', 'labels'].forEach((name) => this.group(name).selectAll('*').remove());
  }

  render(country: string, lenses: PlacedLens[]): void {
    if (lenses.length === 0) {
      this.clear();
      return;
    }

    const width = this.root.node()!.clientWidth || 300;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
    this.svg.attr('width', width).attr('height', HEIGHT);

    // Call extents exactly once — never inside a per-tick loop (research Pitfall 2).
    const [gdpMin, gdpMax] = this.dataset.gdpPerCapitaGlobalExtent();
    const [co2Min, co2Max] = this.dataset.co2PerCapitaGlobalExtent();

    const columns = this.columnPositions(lenses, innerW);
    const uniqueYears = [...columns.keys()];

    const series = this.dataset.series(country);
    const rawByYear = new Map<number, RawValues>();
    const co2Points: MetricPoint[] = [];
    const gdpPoints: MetricPoint[] = [];

    for (const year of uniqueYears) {
      const pt = series?.points.find((p) => p.year === year);
      const v = pt?.extra['co2_including_luc_per_capita'];
      const rawCo2 = v !== undefined && Number.isFinite(v) ? v : undefined;
      const rawGdp = pt ? getGdpPerCapita(pt) : undefined;
      rawByYear.set(year, { co2: rawCo2, gdp: rawGdp });
      co2Points.push({ x: columns.get(year)!, y: normalize(rawCo2, co2Min, co2Max) });
      gdpPoints.push({ x: columns.get(year)!, y: normalize(rawGdp, gdpMin, gdpMax) });
    }

    const y: YScale = scaleLinear().domain([0, 1]).range([innerH, 0]);
    this.renderAxes(columns, lenses, y, innerH);
    this.renderLines(co2Points, gdpPoints, y, innerW, innerH);
    this.renderLabels(uniqueYears, columns, rawByYear, y, [co2Min, co2Max], [gdpMin, gdpMax]);
  }

  private renderAxes(
    columns: Map<number, number>,
    lenses: PlacedLens[],
    y: YScale,
    innerH: number,
  ): void {
    const g = this.group('axes');

    // Left y-axis — NOT axisRight (research Anti-Pattern "floating-right y-scale").
    const yAxisGroup = g
      .selectAll<SVGGElement, null>('g.gdp-slope-chart__y-axis')
      .data([null])
      .join('g')
      .attr('class', 'gdp-slope-chart__y-axis') as unknown as SvgGroup;
    yAxisGroup.call(axisLeft(y).ticks(5));

    g.selectAll<SVGLineElement, number>('line.gdp-slope-chart__axis-line')
      .data([...columns.values()])
      .join('line')
      .attr('class', 'gdp-slope-chart__axis-line')
      .attr('x1', (d) => d).attr('y1', 0)
      .attr('x2', (d) => d).attr('y2', innerH);

    g.selectAll<SVGTextElement, { year: number; x: number }>('text.gdp-slope-chart__year-label')
      .data([...columns.entries()].map(([yr, x]) => ({ year: yr, x })), (d) => String(d.year))
      .join('text')
      .attr('class', 'gdp-slope-chart__year-label')
      .attr('x', (d) => d.x).attr('y', innerH + 16)
      .attr('text-anchor', 'middle')
      .text((d) => YEAR_FMT(d.year));

    g.selectAll<SVGLineElement, { x1: number; x2: number; color: string }>('line.gdp-slope-chart__stage-bar')
      .data(lenses.map((l) => ({
        x1: columns.get(l.startYear)!,
        x2: columns.get(l.endYear)!,
        color: STAGE_COLORS[l.stage],
      })))
      .join('line')
      .attr('class', 'gdp-slope-chart__stage-bar')
      .attr('x1', (d) => d.x1).attr('y1', -8)
      .attr('x2', (d) => d.x2).attr('y2', -8)
      .attr('stroke', (d) => d.color).attr('stroke-width', 3);
  }

  private renderLines(
    co2Points: MetricPoint[],
    gdpPoints: MetricPoint[],
    y: YScale,
    innerW: number,
    innerH: number,
  ): void {
    const g = this.group('lines');
    g.selectAll('*').remove();

    // Two separate line generators with .defined() for broken-line gap handling (research Pattern 3).
    const co2LineGen = line<MetricPoint>()
      .defined((d) => d.y !== undefined)
      .x((d) => d.x)
      .y((d) => y(d.y!));

    const gdpLineGen = line<MetricPoint>()
      .defined((d) => d.y !== undefined)
      .x((d) => d.x)
      .y((d) => y(d.y!));

    g.append('path')
      .attr('class', 'gdp-slope-chart__metric-line')
      .attr('d', co2LineGen(co2Points) ?? '')
      .attr('stroke', CO2_COLOR).attr('stroke-width', 2).attr('fill', 'none');

    g.append('path')
      .attr('class', 'gdp-slope-chart__metric-line')
      .attr('d', gdpLineGen(gdpPoints) ?? '')
      .attr('stroke', GDP_COLOR).attr('stroke-width', 2).attr('fill', 'none');

    // Endpoint dots make single-column gaps visible.
    co2Points.filter((d) => d.y !== undefined).forEach((d) => {
      g.append('circle').attr('class', 'gdp-slope-chart__dot')
        .attr('cx', d.x).attr('cy', y(d.y!)).attr('r', 3).attr('fill', CO2_COLOR);
    });

    gdpPoints.filter((d) => d.y !== undefined).forEach((d) => {
      g.append('circle').attr('class', 'gdp-slope-chart__dot')
        .attr('cx', d.x).attr('cy', y(d.y!)).attr('r', 3).attr('fill', GDP_COLOR);
    });

    const anyData = [...co2Points, ...gdpPoints].some((d) => d.y !== undefined);
    if (!anyData) {
      g.append('text')
        .attr('class', 'gdp-slope-chart__empty')
        .attr('x', innerW / 2).attr('y', innerH / 2)
        .attr('text-anchor', 'middle')
        .text('No data for lens range');
    }
  }

  private renderLabels(
    uniqueYears: number[],
    columns: Map<number, number>,
    rawByYear: Map<number, RawValues>,
    y: YScale,
    co2Extent: [number, number],
    gdpExtent: [number, number],
  ): void {
    const g = this.group('labels');
    g.selectAll('*').remove();

    const rightYear = uniqueYears[uniqueYears.length - 1];
    const rightX = columns.get(rightYear)!;
    const rightRaw = rawByYear.get(rightYear);

    // Metric name labels positioned at the actual line endpoints (fallback to mid-scale).
    const co2LabelY = rightRaw?.co2 !== undefined
      ? y(normalize(rightRaw.co2, co2Extent[0], co2Extent[1]) ?? 0)
      : y(0.7);
    const gdpLabelY = rightRaw?.gdp !== undefined
      ? y(normalize(rightRaw.gdp, gdpExtent[0], gdpExtent[1]) ?? 0)
      : y(0.3);

    g.append('text').attr('class', 'gdp-slope-chart__label')
      .attr('x', rightX + 4).attr('y', co2LabelY)
      .attr('dy', '0.35em').attr('fill', CO2_COLOR).text('CO₂/cap');

    g.append('text').attr('class', 'gdp-slope-chart__label')
      .attr('x', rightX + 4).attr('y', gdpLabelY)
      .attr('dy', '0.35em').attr('fill', GDP_COLOR).text('GDP/cap');

    // Per-year raw value labels: CO₂ above the dot, GDP below (to avoid collision).
    for (const year of uniqueYears) {
      const x = columns.get(year)!;
      const raw = rawByYear.get(year);
      if (!raw) continue;

      if (raw.co2 !== undefined) {
        const ny = y(normalize(raw.co2, co2Extent[0], co2Extent[1]) ?? 0);
        g.append('text').attr('class', 'gdp-slope-chart__value-label')
          .attr('x', x).attr('y', ny - 8)
          .attr('text-anchor', 'middle').attr('fill', CO2_COLOR)
          .text(CO2_FMT(raw.co2));
      }

      if (raw.gdp !== undefined) {
        const ny = y(normalize(raw.gdp, gdpExtent[0], gdpExtent[1]) ?? 0);
        g.append('text').attr('class', 'gdp-slope-chart__value-label')
          .attr('x', x).attr('y', ny + 16)
          .attr('text-anchor', 'middle').attr('fill', GDP_COLOR)
          .text(GDP_FMT(raw.gdp));
      }
    }
  }

  private columnPositions(lenses: PlacedLens[], innerW: number): Map<number, number> {
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

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}

function normalize(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (max === min) return 0;
  return (value - min) / (max - min);
}
