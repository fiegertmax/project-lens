import { axisLeft, format, scaleLinear, select } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { STAGE_COLORS } from '../config';
import { getGdpPerCapita } from '../utils/getGdpPerCapita';
import type { PlacedLens } from '../state/CountryLensState';

const MARGIN = { top: 20, right: 56, bottom: 28, left: 52 };
const HEIGHT = 360;
const YEAR_FMT = format('d');
const CO2_COLOR = '#c0392b';
const GDP_COLOR = '#2e86c1';

type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;
type YScale = ScaleLinear<number, number>;

interface LensMetrics {
  lens: PlacedLens;
  startX: number;
  endX: number;
  co2Pct: number | undefined;
  gdpPct: number | undefined;
}

/** Slope chart showing percent change in CO₂/cap and GDP/cap over each lens window. */
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
    this.root.style('display', 'none');
  }

  render(country: string, lenses: PlacedLens[], includeLUC = true): void {
    if (lenses.length === 0) {
      this.clear();
      return;
    }

    this.root.style('display', null);
    const width = this.root.node()!.clientWidth || 300;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
    this.svg.attr('width', width).attr('height', HEIGHT);

    const series = this.dataset.series(country);
    const columns = this.columnPositions(lenses, innerW);

    const metrics: LensMetrics[] = lenses.map((lens) => {
      const startPt = series?.points.find((p) => p.year === lens.startYear);
      const endPt = series?.points.find((p) => p.year === lens.endYear);
      const co2Col = includeLUC ? 'co2_including_luc_per_capita' : 'co2_per_capita';
      const co2Start = finiteOrUndef(startPt?.extra[co2Col]);
      const co2End = finiteOrUndef(endPt?.extra[co2Col]);
      const gdpStart = startPt ? getGdpPerCapita(startPt) : undefined;
      const gdpEnd = endPt ? getGdpPerCapita(endPt) : undefined;
      return {
        lens,
        startX: columns.get(lens.startYear)!,
        endX: columns.get(lens.endYear)!,
        co2Pct: pctChange(co2Start, co2End),
        gdpPct: pctChange(gdpStart, gdpEnd),
      };
    });

    const allPcts = metrics
      .flatMap((m) => [m.co2Pct, m.gdpPct])
      .filter((v): v is number => v !== undefined);
    const yMin = allPcts.length ? Math.min(0, ...allPcts) : -10;
    const yMax = allPcts.length ? Math.max(0, ...allPcts) : 10;
    const y: YScale = scaleLinear().domain([yMin, yMax]).nice().range([innerH, 0]);

    this.renderAxes(columns, lenses, y, innerH, innerW);
    this.renderLines(metrics, y, innerW, innerH);
    this.renderLabels(metrics, y);
  }

  private renderAxes(
    columns: Map<number, number>,
    lenses: PlacedLens[],
    y: YScale,
    innerH: number,
    innerW: number,
  ): void {
    const g = this.group('axes');

    const yAxisGroup = g
      .selectAll<SVGGElement, null>('g.gdp-slope-chart__y-axis')
      .data([null])
      .join('g')
      .attr('class', 'gdp-slope-chart__y-axis') as unknown as SvgGroup;
    yAxisGroup.call(
      axisLeft(y)
        .ticks(5)
        .tickFormat((d) => {
          const n = Number(d);
          return n === 0 ? '0%' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
        }),
    );

    // Horizontal baseline at 0%
    const zeroY = y(0);
    g.selectAll<SVGLineElement, null>('line.gdp-slope-chart__baseline')
      .data([null])
      .join('line')
      .attr('class', 'gdp-slope-chart__baseline')
      .attr('x1', 0).attr('y1', zeroY)
      .attr('x2', innerW).attr('y2', zeroY);

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

  private renderLines(metrics: LensMetrics[], y: YScale, innerW: number, innerH: number): void {
    const g = this.group('lines');
    g.selectAll('*').remove();

    const zeroY = y(0);
    let anyData = false;

    for (const m of metrics) {
      if (m.co2Pct !== undefined) {
        anyData = true;
        const endY = y(m.co2Pct);
        g.append('line').attr('class', 'gdp-slope-chart__metric-line')
          .attr('x1', m.startX).attr('y1', zeroY)
          .attr('x2', m.endX).attr('y2', endY)
          .attr('stroke', CO2_COLOR).attr('stroke-width', 2);
        g.append('circle').attr('class', 'gdp-slope-chart__dot')
          .attr('cx', m.startX).attr('cy', zeroY).attr('r', 3).attr('fill', CO2_COLOR);
        g.append('circle').attr('class', 'gdp-slope-chart__dot')
          .attr('cx', m.endX).attr('cy', endY).attr('r', 3).attr('fill', CO2_COLOR);
      }
      if (m.gdpPct !== undefined) {
        anyData = true;
        const endY = y(m.gdpPct);
        g.append('line').attr('class', 'gdp-slope-chart__metric-line')
          .attr('x1', m.startX).attr('y1', zeroY)
          .attr('x2', m.endX).attr('y2', endY)
          .attr('stroke', GDP_COLOR).attr('stroke-width', 2);
        g.append('circle').attr('class', 'gdp-slope-chart__dot')
          .attr('cx', m.startX).attr('cy', zeroY).attr('r', 3).attr('fill', GDP_COLOR);
        g.append('circle').attr('class', 'gdp-slope-chart__dot')
          .attr('cx', m.endX).attr('cy', endY).attr('r', 3).attr('fill', GDP_COLOR);
      }
    }

    if (!anyData) {
      g.append('text')
        .attr('class', 'gdp-slope-chart__empty')
        .attr('x', innerW / 2).attr('y', innerH / 2)
        .attr('text-anchor', 'middle')
        .text('No data for lens range');
    }
  }

  private renderLabels(metrics: LensMetrics[], y: YScale): void {
    const g = this.group('labels');
    g.selectAll('*').remove();

    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i];
      const isLast = i === metrics.length - 1;

      if (m.co2Pct !== undefined) {
        const endY = y(m.co2Pct);
        g.append('text').attr('class', 'gdp-slope-chart__value-label')
          .attr('x', m.endX).attr('y', endY - 8)
          .attr('text-anchor', 'middle').attr('fill', CO2_COLOR)
          .text(fmtPct(m.co2Pct));
        if (isLast) {
          g.append('text').attr('class', 'gdp-slope-chart__label')
            .attr('x', m.endX + 4).attr('y', endY)
            .attr('dy', '0.35em').attr('fill', CO2_COLOR).text('CO₂/cap');
        }
      }

      if (m.gdpPct !== undefined) {
        const endY = y(m.gdpPct);
        g.append('text').attr('class', 'gdp-slope-chart__value-label')
          .attr('x', m.endX).attr('y', endY + 16)
          .attr('text-anchor', 'middle').attr('fill', GDP_COLOR)
          .text(fmtPct(m.gdpPct));
        if (isLast) {
          g.append('text').attr('class', 'gdp-slope-chart__label')
            .attr('x', m.endX + 4).attr('y', endY)
            .attr('dy', '0.35em').attr('fill', GDP_COLOR).text('GDP/cap');
        }
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

function pctChange(start: number | undefined, end: number | undefined): number | undefined {
  if (start === undefined || end === undefined || start === 0) return undefined;
  return ((end - start) / Math.abs(start)) * 100;
}

function finiteOrUndef(v: number | undefined): number | undefined {
  return v !== undefined && Number.isFinite(v) ? v : undefined;
}

function fmtPct(v: number): string {
  return v === 0 ? '0%' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
