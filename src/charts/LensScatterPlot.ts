import { axisBottom, axisLeft, format, hcl, scaleLinear, select } from 'd3';
import type { ScaleLinear, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { RawPoint } from '../data/types';
import type { MetricMode } from '../state/AppState';
import type { PlacedLens } from '../state/CountryLensState';
import { getGdpPerCapita } from '../utils/getGdpPerCapita';
import { showCursorTooltip, hideCursorTooltip } from '../ui/cursorTooltip';

const MARGIN = { top: 20, right: 20, bottom: 48, left: 68 };
const HEIGHT = 360;
const DOT_RADIUS = 4;
// HCL luminance band for year encoding: later year → darker, so the most
// recent dots have the highest contrast against the white background. Bounded
// so early dots stay visible and late dots stay richly colored, not near-black.
const LUM_EARLY = 82;
const LUM_LATE = 35;

const SI_FMT = format('.2s');
const PERCAP_FMT = format('.2~f');

type LinearScale = ScaleLinear<number, number>;
type SvgGroup = Selection<SVGGElement, unknown, null, undefined>;
type PlotLayer = Selection<SVGGElement, null, SVGGElement, unknown>;

const DRAG_HINT = 'Found a trend? Drag-and-drop a country from the line chart to a blank space to research it further.';

interface ScatterPoint {
  key: string;
  country: string;
  year: number;
  x: number;
  y: number;
  color: string;
}

/** Per-metric axis config: which value each dot's x/y reads and how it's labelled. */
interface ScatterMetricConfig {
  xValue: (pt: RawPoint) => number | undefined;
  yValue: (pt: RawPoint) => number | undefined;
  xLabel: string;
  yLabel: string;
  xFmt: (n: number) => string;
  yFmt: (n: number) => string;
}

function metricConfig(metric: MetricMode, includeLUC: boolean): ScatterMetricConfig {
  const finite = (v: number): number | undefined => (Number.isFinite(v) ? v : undefined);
  if (metric === 'per-capita') {
    const co2Col = includeLUC ? 'co2_including_luc_per_capita' : 'co2_per_capita';
    return {
      xValue: (pt) => finite(pt.extra[co2Col]),
      yValue: (pt) => getGdpPerCapita(pt),
      xLabel: 'CO₂ per capita (t)',
      yLabel: 'GDP per capita ($)',
      xFmt: PERCAP_FMT,
      yFmt: SI_FMT,
    };
  }
  const co2Col = includeLUC ? 'co2_including_luc' : 'co2';
  return {
    xValue: (pt) => finite(pt.extra[co2Col]),
    yValue: (pt) => finite(pt.extra['gdp']),
    xLabel: 'CO₂ emissions (Mt)',
    yLabel: 'GDP (int-$)',
    xFmt: SI_FMT,
    yFmt: SI_FMT,
  };
}

/** Scatterplot rendered in the combined chart's slope cell when a lens spans multiple countries. */
export class LensScatterPlot {
  private readonly dataset: EmissionsDataset;
  private readonly root: Selection<HTMLDivElement, unknown, null, undefined>;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly plot: SvgGroup;

  /** Fired when a dot is hovered (country) or the hover ends (null). */
  onHoverCountry?: (country: string | null) => void;

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
    metric: MetricMode,
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

    const cfg = metricConfig(metric, includeLUC);
    const points = this.collectPoints(lenses, countries, cfg, colorFor);

    if (points.length === 0) {
      this.renderEmpty(innerW, innerH);
      return;
    }

    this.applyYearLuminance(points);

    const xMax = Math.max(...points.map((p) => p.x));
    const yMax = Math.max(...points.map((p) => p.y));
    const x = scaleLinear().domain([0, xMax]).nice().range([0, innerW]);
    const y = scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    this.group('empty').selectAll('*').remove();
    this.renderAxes(x, y, innerH, innerW, cfg);
    this.renderPoints(points, x, y);
  }

  private collectPoints(
    lenses: PlacedLens[],
    countries: string[],
    cfg: ScatterMetricConfig,
    colorFor: (country: string) => string,
  ): ScatterPoint[] {
    const points: ScatterPoint[] = [];
    for (const lens of lenses) {
      for (let year = lens.startYear; year <= lens.endYear; year++) {
        for (const country of countries) {
          const pt = this.dataset.series(country)?.points.find((p) => p.year === year);
          if (!pt) continue;
          const x = cfg.xValue(pt);
          const y = cfg.yValue(pt);
          if (x === undefined || x <= 0 || y === undefined || y <= 0) continue;
          points.push({
            key: `${country}-${year}`,
            country,
            year,
            x,
            y,
            color: colorFor(country),
          });
        }
      }
    }
    return points;
  }

  /**
   * Encodes the year into each dot's color via HCL luminance: hue/chroma stay
   * from the country, later years get higher luminance so trends read as a
   * dark→light progression per country.
   */
  private applyYearLuminance(points: ScatterPoint[]): void {
    const years = points.map((p) => p.year);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const span = maxYear - minYear;
    for (const p of points) {
      const t = span === 0 ? 1 : (p.year - minYear) / span;
      const c = hcl(p.color);
      c.l = LUM_EARLY + t * (LUM_LATE - LUM_EARLY);
      p.color = c.toString();
    }
  }

  private renderAxes(
    x: LinearScale,
    y: LinearScale,
    innerH: number,
    innerW: number,
    cfg: ScatterMetricConfig,
  ): void {
    const g = this.group('axes');

    (g.selectAll<SVGGElement, null>('g.lens-scatter-plot__x-axis')
      .data([null])
      .join('g')
      .attr('class', 'lens-scatter-plot__x-axis')
      .attr('transform', `translate(0,${innerH})`) as unknown as SvgGroup).call(
      axisBottom(x).ticks(5).tickFormat((d) => cfg.xFmt(Number(d))),
    );

    (g.selectAll<SVGGElement, null>('g.lens-scatter-plot__y-axis')
      .data([null])
      .join('g')
      .attr('class', 'lens-scatter-plot__y-axis') as unknown as SvgGroup).call(
      axisLeft(y).ticks(5).tickFormat((d) => cfg.yFmt(Number(d))),
    );

    g.selectAll<SVGTextElement, string>('text.lens-scatter-plot__x-label')
      .data([cfg.xLabel])
      .join('text')
      .attr('class', 'lens-scatter-plot__x-label')
      .attr('x', innerW / 2)
      .attr('y', innerH + 40)
      .attr('text-anchor', 'middle')
      .text((d) => d);

    g.selectAll<SVGTextElement, string>('text.lens-scatter-plot__y-label')
      .data([cfg.yLabel])
      .join('text')
      .attr('class', 'lens-scatter-plot__y-label')
      .attr('transform', `translate(${-MARGIN.left + 14},${innerH / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .text((d) => d);
  }

  /** Dims dots not belonging to `country`; pass null to reset all dots. */
  highlightCountry(country: string | null): void {
    this.group('points')
      .selectAll<SVGCircleElement, ScatterPoint>('circle.lens-scatter-plot__point')
      .transition().duration(100)
      .attr('opacity', (d) =>
        country === null ? 0.72 : d.country === country ? 0.95 : 0.1,
      );
  }

  private renderPoints(points: ScatterPoint[], x: LinearScale, y: LinearScale): void {
    const self = this;
    this.group('points')
      .selectAll<SVGCircleElement, ScatterPoint>('circle.lens-scatter-plot__point')
      .data(points, (d) => d.key)
      .join('circle')
      .attr('class', 'lens-scatter-plot__point')
      .attr('cx', (d) => x(d.x))
      .attr('cy', (d) => y(d.y))
      .attr('r', DOT_RADIUS)
      .attr('fill', (d) => d.color)
      .attr('opacity', 0.72)
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 0.5)
      .on('pointerenter', function (ev: PointerEvent, d) {
        showCursorTooltip(DRAG_HINT, ev.clientX, ev.clientY);
        self.onHoverCountry?.(d.country);
      })
      .on('pointermove', function (ev: PointerEvent) {
        showCursorTooltip(DRAG_HINT, ev.clientX, ev.clientY);
      })
      .on('pointerleave', () => {
        hideCursorTooltip();
        self.onHoverCountry?.(null);
      });
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
