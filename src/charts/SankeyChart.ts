import { scaleOrdinal, schemeTableau10, select } from 'd3';
import type { ScaleOrdinal, Selection } from 'd3';
import { SANKEY_TOP_COUNTRIES } from '../config';
import { BUNKER_ENTITIES, CONTINENTS, FOCUSABLE_CONTINENTS } from '../data/continents';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { SankeyDetailLens } from './SankeyDetailLens';
import { SankeySourceLens } from './SankeySourceLens';
import { computeVisibleLabels, LABEL_LINE_HEIGHT, SankeyDiagram } from './SankeyDiagram';
import type { SankeyExtent } from './SankeyDiagram';
import {
  addNode,
  buildRootGraph,
  countriesOfContinent,
  createGraphBuilder,
  EPSILON,
} from './sankeyGraph';
import type { GraphBuilder } from './sankeyGraph';

const WORLD_COLOR = '#6b6375';
const BUNKER_COLOR = '#b9b9c2';

/** left matches .sankey-chart__title's padding-left, so the World label aligns with the heading. */
const MARGIN = { top: 24, right: 220, bottom: 10, left: 45 };
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
/** Matches .sankey-chart's CSS padding, so the SVG fills its content box exactly. */
const CONTAINER_PADDING = 16;
/** Reserved space above the SVG for .sankey-chart__title (line height + margin-bottom). */
const TITLE_RESERVED_HEIGHT = 30;

interface GlobalGraph {
  builder: GraphBuilder;
  /** Country names shown as individual nodes (not folded into "Other X"). */
  shownCountries: Set<string>;
}

/** Sankey diagram of global CO2 emissions: World -> continents/transport -> top countries. */
export class SankeyChart {
  private readonly container: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly empty: HTMLParagraphElement;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly diagram: SankeyDiagram;
  private readonly lens: SankeyDetailLens;
  private readonly sourceLens: SankeySourceLens;
  private readonly dataset: EmissionsDataset;
  private readonly continentColor: ScaleOrdinal<string, string>;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;
    this.continentColor = scaleOrdinal<string, string>()
      .domain(FOCUSABLE_CONTINENTS)
      .range(schemeTableau10);

    this.container = document.createElement('div');
    this.container.className = 'sankey-chart';
    parent.appendChild(this.container);

    this.title = document.createElement('h3');
    this.title.className = 'sankey-chart__title';
    this.empty = document.createElement('p');
    this.empty.className = 'sankey-chart__empty';
    this.empty.textContent = 'No global emissions data for this year.';
    this.container.append(this.title, this.empty);

    this.svg = select(this.container).append('svg').attr('class', 'sankey-chart__svg');
    const diagramGroup = this.svg.append('g').attr('class', 'sankey-diagram');
    this.diagram = new SankeyDiagram(diagramGroup);
    this.lens = new SankeyDetailLens(this.svg, dataset);
    this.sourceLens = new SankeySourceLens(this.svg, dataset);
  }

  /** Rebuild the diagram for the given year, optionally zoomed into one continent. */
  update(year: number, focusContinent: string | null): void {
    this.title.textContent = focusContinent !== null
      ? `${focusContinent} CO₂ emissions, ${year} (million tonnes)`
      : `Global CO₂ emissions, ${year} (million tonnes)`;
    this.empty.textContent = focusContinent !== null
      ? `No emissions data for ${focusContinent} in this year.`
      : 'No global emissions data for this year.';

    this.render(year, focusContinent);
  }

  /** Root element, used by the app to toggle visibility between base visualizations. */
  node(): HTMLDivElement {
    return this.container;
  }

  destroy(): void {
    this.container.remove();
  }

  private render(year: number, focusContinent: string | null): void {
    // Fixed footprint regardless of year: as totals grow, ky shrinks and bars get
    // thinner, so a continent's share of the World bar stays visually comparable
    // across years instead of the whole chart growing.
    const focused = focusContinent !== null;
    const width = Math.max(this.container.clientWidth - 2 * CONTAINER_PADDING, MIN_WIDTH);
    const height = Math.max(
      this.container.clientHeight - 2 * CONTAINER_PADDING - TITLE_RESERVED_HEIGHT,
      MIN_HEIGHT,
    );
    // Extra bottom margin in focused mode so the inflation footnote clears the chart area.
    const bottomMargin = focused ? MARGIN.bottom + 18 : MARGIN.bottom;
    const extent: SankeyExtent = [
      [MARGIN.left, MARGIN.top],
      [width - MARGIN.right, height - bottomMargin],
    ];
    let builder: GraphBuilder;
    let shownCountries: Set<string>;

    if (focused) {
      builder = this.buildFocusedGraph(focusContinent!, year);
      shownCountries = new Set();
    } else {
      ({ builder, shownCountries } = this.buildGlobalGraph(year, extent));
    }

    this.empty.classList.toggle('sankey-chart__empty--hidden', builder.nodes.length > 0);

    if (builder.nodes.length === 0) {
      this.svg.attr('width', 0).attr('height', 0);
      this.lens.update([], year, new Set());
      this.sourceLens.update([], year, false);
      return;
    }

    this.svg.attr('width', width).attr('height', height);
    const graphNodes = this.diagram.draw(builder, extent, focused ? LABEL_LINE_HEIGHT : 0);
    this.lens.update(focused ? [] : graphNodes, year, focused ? new Set() : shownCountries);
    this.sourceLens.update(graphNodes, year, focused);
  }

  /**
   * Iteratively build the global graph: after each layout pass, fold any unlabelled
   * country node into "Other X" and rebuild until every direct node has a label.
   *
   * Convergence is guaranteed because `excluded` only grows (each pass adds at least
   * one name) and the candidate pool per continent is bounded by SANKEY_TOP_COUNTRIES.
   */
  private buildGlobalGraph(year: number, extent: SankeyExtent): GlobalGraph {
    const excluded = new Set<string>();
    let current = this.buildGraph(year, excluded);

    while (current.builder.nodes.length > 0) {
      const layoutNodes = this.diagram.layoutOnly(current.builder, extent);
      const visible = computeVisibleLabels(layoutNodes);
      const maxDepth = Math.max(...layoutNodes.map((n) => n.depth ?? 0));

      const unlabeled = layoutNodes
        .filter((n) => n.depth === maxDepth && !n.name.startsWith('Other ') && !visible.has(n))
        .map((n) => n.name);

      if (unlabeled.length === 0) return current;

      for (const name of unlabeled) excluded.add(name);
      current = this.buildGraph(year, excluded);
    }

    return current;
  }

  /** World -> populated continents/transport -> top countries (+ "Other <continent>"). */
  private buildGraph(year: number, excludedCountries: Set<string>): GlobalGraph {
    const builder = createGraphBuilder();
    const shownCountries = new Set<string>();

    const worldValue = this.dataset.valueInYear('World', year);
    if (worldValue === undefined || worldValue <= EPSILON) return { builder, shownCountries };

    const worldIndex = addNode(builder, 'World', WORLD_COLOR);

    for (const name of [...CONTINENTS, ...BUNKER_ENTITIES]) {
      const value = this.dataset.valueInYear(name, year);
      if (value === undefined || value <= EPSILON) continue;

      const isBunker = (BUNKER_ENTITIES as readonly string[]).includes(name);
      const color = isBunker ? BUNKER_COLOR : this.continentColor(name);
      const index = addNode(builder, name, color);
      builder.links.push({ source: worldIndex, target: index, value });

      if (!isBunker) {
        const shown = this.addCountries(builder, name, year, index, color, value, excludedCountries);
        for (const c of shown) shownCountries.add(c);
      }
    }

    return { builder, shownCountries };
  }

  /**
   * Adds up to SANKEY_TOP_COUNTRIES direct country nodes for a continent, skipping
   * `excludedCountries`, then adds an "Other <continent>" node for the remainder.
   * Returns the names of countries added as direct nodes.
   */
  private addCountries(
    builder: GraphBuilder,
    continent: string,
    year: number,
    parentIndex: number,
    color: string,
    continentValue: number,
    excludedCountries: Set<string>,
  ): string[] {
    const countries = countriesOfContinent(this.dataset, continent, year);

    // Only the original top-N are ever candidates; do NOT promote rank 4+ as replacements.
    const top = countries
      .slice(0, SANKEY_TOP_COUNTRIES)
      .filter((c) => !excludedCountries.has(c.country));

    for (const { country, value } of top) {
      const index = addNode(builder, country, color);
      builder.links.push({ source: parentIndex, target: index, value });
    }

    const other = continentValue - top.reduce((sum, c) => sum + c.value, 0);
    if (other > EPSILON) {
      const index = addNode(builder, `Other ${continent}`, color);
      builder.links.push({ source: parentIndex, target: index, value: other });
    }

    return top.map((c) => c.country);
  }

  /** <Continent> -> ALL of its countries (no "Other", no top-N limiting). */
  private buildFocusedGraph(continent: string, year: number): GraphBuilder {
    const countries = countriesOfContinent(this.dataset, continent, year);
    return buildRootGraph(continent, this.continentColor(continent), countries);
  }
}
