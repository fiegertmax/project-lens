import { scaleOrdinal, schemeTableau10, select } from 'd3';
import type { ScaleOrdinal, Selection } from 'd3';
import { BUNKER_ENTITIES, CONTINENTS, FOCUSABLE_CONTINENTS } from '../data/continents';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { PieDiagram } from './PieDiagram';
import type { PieSliceInput } from './PieDiagram';
import { countriesOfContinent, EPSILON } from './sankeyGraph';

const BUNKER_COLOR = '#b9b9c2';
const CONTAINER_PADDING = 16;
const TITLE_RESERVED_HEIGHT = 30;
const FOOTNOTE_RESERVED_HEIGHT = 40;
/** Leaves room around the pie for outside labels + leader polylines. */
const LABEL_MARGIN = 90;
const MIN_RADIUS = 200;

/** Base pie chart of CO₂ emissions: shows continents in global mode and a focused
 *  continent's countries when focus is set. Mirrors SankeyChart's lifecycle so the
 *  app can swap between them by visibility. */
export class PieChart {
  /** Shared by base PieChart and per-lens PieLens for consistent continent colors. */
  static readonly continentColor: ScaleOrdinal<string, string> = scaleOrdinal<string, string>()
    .domain(FOCUSABLE_CONTINENTS)
    .range(schemeTableau10);

  private readonly container: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly empty: HTMLParagraphElement;
  private readonly lensLayer: HTMLDivElement;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly diagramGroup: Selection<SVGGElement, unknown, null, undefined>;
  private readonly diagram: PieDiagram;
  private readonly dataset: EmissionsDataset;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;

    this.container = document.createElement('div');
    this.container.className = 'pie-chart';
    parent.appendChild(this.container);

    this.title = document.createElement('h3');
    this.title.className = 'pie-chart__title';
    this.empty = document.createElement('p');
    this.empty.className = 'pie-chart__empty';
    this.empty.textContent = 'No global emissions data for this year.';
    this.container.append(this.title, this.empty);

    this.svg = select(this.container).append('svg').attr('class', 'pie-chart__svg');
    this.diagramGroup = this.svg.append('g').attr('class', 'pie-diagram-root');
    this.diagram = new PieDiagram(this.diagramGroup);

    this.lensLayer = document.createElement('div');
    this.lensLayer.className = 'pie-lens-layer';
    this.container.appendChild(this.lensLayer);
  }

  /** Lens overlay container — `PieLensManager` mounts/repositions lenses inside it. */
  overlay(): HTMLDivElement {
    return this.lensLayer;
  }

  /** Root element, used by the app to toggle visibility between base visualizations. */
  node(): HTMLDivElement {
    return this.container;
  }

  destroy(): void {
    this.container.remove();
  }

  /** Rebuild the pie for the given year, optionally zoomed into one continent. */
  update(year: number, focusContinent: string | null): void {
    const focused = focusContinent !== null;
    this.title.textContent = focused
      ? `${focusContinent} CO₂ emissions, ${year} (million tonnes)`
      : `Global CO₂ emissions, ${year} (million tonnes)`;
    this.empty.textContent = focused
      ? `No emissions data for ${focusContinent} in this year.`
      : 'No global emissions data for this year.';

    const slices = focused ? this.focusedSlices(focusContinent!, year) : this.globalSlices(year);
    this.render(slices);
  }

  private globalSlices(year: number): PieSliceInput[] {
    const slices: PieSliceInput[] = [];
    for (const name of CONTINENTS) {
      const value = this.dataset.valueInYear(name, year);
      if (value === undefined || value <= EPSILON) continue;
      slices.push({
        key: name,
        label: name,
        value,
        color: PieChart.continentColor(name),
        dataAttrs: { 'slice-level': 'continent', 'slice-name': name },
      });
    }
    for (const name of BUNKER_ENTITIES) {
      const value = this.dataset.valueInYear(name, year);
      if (value === undefined || value <= EPSILON) continue;
      slices.push({
        key: name,
        label: name,
        value,
        color: BUNKER_COLOR,
        // Bunkers are not part of any continent and have no country/source breakdown.
        dataAttrs: { 'slice-level': 'bunker', 'slice-name': name, 'slice-disabled': 'true' },
      });
    }
    return slices;
  }

  private focusedSlices(continent: string, year: number): PieSliceInput[] {
    const color = PieChart.continentColor(continent);
    return countriesOfContinent(this.dataset, continent, year).map(({ country, value }) => ({
      key: country,
      label: country,
      value,
      color,
      dataAttrs: { 'slice-level': 'country', 'slice-name': country },
    }));
  }

  private render(slices: PieSliceInput[]): void {
    const hasData = slices.length > 0;
    this.empty.classList.toggle('pie-chart__empty--hidden', hasData);

    if (!hasData) {
      this.svg.attr('width', 0).attr('height', 0);
      this.diagramGroup.selectAll('*').remove();
      return;
    }

    const width = Math.max(this.container.clientWidth - 2 * CONTAINER_PADDING, MIN_RADIUS * 2 + 2 * LABEL_MARGIN);
    const height = Math.max(
      this.container.clientHeight - 2 * CONTAINER_PADDING - TITLE_RESERVED_HEIGHT - FOOTNOTE_RESERVED_HEIGHT,
      MIN_RADIUS * 2 + 2 * LABEL_MARGIN,
    );
    const radius = Math.max(MIN_RADIUS, Math.min(width, height) / 2 - LABEL_MARGIN);
    const cx = width / 2;
    const cy = height / 2;

    this.svg.attr('width', width).attr('height', height + FOOTNOTE_RESERVED_HEIGHT);

    const result = this.diagram.draw({ x: cx, y: cy }, radius, slices);
    const footnotes: string[] = [];
    if (result.inflated.size > 0) footnotes.push('* Slice enlarged for visibility — label shows actual share.');
    this.diagram.drawFootnote(CONTAINER_PADDING, height + 18, footnotes);

    // Keep the lens overlay in the right place — covers the SVG area exactly.
    this.lensLayer.style.width = `${width}px`;
    this.lensLayer.style.height = `${height + FOOTNOTE_RESERVED_HEIGHT}px`;
  }
}
