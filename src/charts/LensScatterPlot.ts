import { axisBottom, axisLeft, format, scaleLinear, select } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { PlacedLens } from '../state/CountryLensState';
import { getGdpPerCapita } from '../utils/getGdpPerCapita';

const MARGIN = { top: 20, right: 20, bottom: 48, left: 68 };
const HEIGHT = 360;
const DOT_RADIUS = 4;

const GDP_FMT = format('.2s');
const CO2_FMT = format('.2~f');

type LinearScale = ScaleLinear<number, number>;
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;

interface ScatterPoint {
  key: string;
  co2PerCap: number;
  gdpPerCap: number;
  color: string;
}

/** Scatterplot rendered in the combined chart's slope cell for per-capita mode. */
export class LensScatterPlot {
  private readonly dataset: EmissionsDataset;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;
    this.root = select(parent).append('div').attr('class', 'lens-scatter-plot');
    this.svg = this.root.append('svg').attr('class', 'lens-scatter-plot__svg');
    this.plot = this.svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  }

  node(): HTMLDivElement {
    return this.root.node()!;
  }

  destroy(): void {
    this.root.remove();
  }

  clear(): void {
    ['axes', 'points', 'empty'].forEach((n) => this.group(n).selectAll('*').remove());
    this.root.style('display', 'none');
  }

  render(
    countries: string[],
    lenses: PlacedLens[],
    includeLUC: boolean,
    colorFor: (country: string) => string,
  ): void {
    if (countries.length === 0 || lenses.length === 0) {
      this.clear();
      return;
    }

    this.root.style('display', null);
    const width = this.root.node()!.clientWidth || 300;
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
    this.svg.attr('width', width).attr('height', HEIGHT);

    const co2Col = includeLUC ? 'co2_including_luc_per_capita' : 'co2_per_capita';
    const points = this.collectPoints(lenses, countries, co2Col, colorFor);

    if (points.length === 0) {
      this.renderEmpty(innerW, innerH);
      return;
    }

    const xMax = Math.max(...points.map((p) => p.co2PerCap));
    const yMax = Math.max(...points.map((p) => p.gdpPerCap));
    const x = scaleLinear().domain([0, xMax]).nice().range([0, innerW]);
    const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    this.group('empty').selectAll('*').remove();
    this.renderAxes(x, y, innerH, innerW);
    this.renderPoints(points, x, y);
  }

  private collectPoints(
    lenses: PlacedLens[],
    countries: string[],
    co2Col: string,
    colorFor: (country: string) => string,
  ): ScatterPoint[] {
    const points: ScatterPoint[] = [];
    for (const lens of lenses) {
      for (let year = lens.startYear; year <= lens.endYear; year++) {
        for (const country of countries) {
          const pt = this.dataset.series(country)?.points.find((p) => p.year === year);
          if (!pt) continue;
          const co2PerCap = pt.extra[co2Col];
          const gdpPerCap = getGdpPerCapita(pt);
          if (!Number.isFinite(co2PerCap) || co2PerCap <= 0) continue;
          if (gdpPerCap === undefined || gdpPerCap <= 0) continue;
          points.push({
            key: `${country}-${year}-${lens.stage}`,
            co2PerCap,
            gdpPerCap,
            color: colorFor(country),
          });
        }
      }
    }
    return points;
  }

  private renderAxes(x: LinearScale, y: LinearScale, innerH: number, innerW: number): void {
    const g = this.group('axes');

    (g.selectAll<SVGGElement, null>('g.lens-scatter-plot__x-axis')
      .data([null])
      .join('g')
      .attr('class', 'lens-scatter-plot__x-axis')
      .attr('transform', `translate(0,${innerH})`) as unknown as SvgGroup).call(
      axisBottom(x).ticks(5).tickFormat((d) => CO2_FMT(Number(d))),
    );

    (g.selectAll<SVGGElement, null>('g.lens-scatter-plot__y-axis')
      .data([null])
      .join('g')
      .attr('class', 'lens-scatter-plot__y-axis') as unknown as SvgGroup).call(
      axisLeft(y).ticks(5).tickFormat((d) => GDP_FMT(Number(d))),
    );

    g.selectAll<SVGTextElement, string>('text.lens-scatter-plot__x-label')
      .data(['CO₂ per capita (t)'])
      .join('text')
      .attr('class', 'lens-scatter-plot__x-label')
      .attr('x', innerW / 2)
      .attr('y', innerH + 40)
      .attr('text-anchor', 'middle')
      .text((d) => d);

    g.selectAll<SVGTextElement, string>('text.lens-scatter-plot__y-label')
      .data(['GDP per capita ($)'])
      .join('text')
      .attr('class', 'lens-scatter-plot__y-label')
      .attr('transform', `translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .text((d) => d);
  }

  private renderPoints(points: ScatterPoint[], x: LinearScale, y: LinearScale): void {
    this.group('points')
      .selectAll<SVGCircleElement, ScatterPoint>('circle.lens-scatter-plot__point')
      .data(points, (d) => d.key)
      .join('circle')
      .attr('class', 'lens-scatter-plot__point')
      .attr('cx', (d) => x(d.co2PerCap))
      .attr('cy', (d) => y(d.gdpPerCap))
      .attr('r', DOT_RADIUS)
      .attr('fill', (d) => d.color)
      .attr('opacity', 0.72)
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 0.5);
  }

  private renderEmpty(innerW: number, innerH: number): void {
    ['axes', 'points'].forEach((n) => this.group(n).selectAll('*').remove());
    this.group('empty')
      .selectAll<SVGTextElement, string>('text')
      .data(['No data for lens range'])
      .join('text')
      .attr('x', innerW / 2)
      .attr('y', innerH / 2)
      .attr('text-anchor', 'middle')
      .text((d) => d);
  }

  private group(name: string): PlotLayer {
    return this.plot
      .selectAll<SVGGElement, null>(`g.${name}`)
      .data([null])
      .join('g')
      .attr('class', name);
  }
}
