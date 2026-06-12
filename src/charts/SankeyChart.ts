import { format, scaleOrdinal, schemeTableau10, select } from 'd3';
import type { ScaleOrdinal, Selection } from 'd3';
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyLink, SankeyNode } from 'd3-sankey';
import { SANKEY_TOP_COUNTRIES } from '../config';
import { BUNKER_ENTITIES, CONTINENTS, COUNTRY_TO_CONTINENT } from '../data/continents';
import type { EmissionsDataset } from '../data/EmissionsDataset';

/** Links/nodes below this value (million tonnes) are dropped as visual noise. */
const EPSILON = 0.05;

const WORLD_COLOR = '#6b6375';
const BUNKER_COLOR = '#b9b9c2';

const NODE_WIDTH = 16;
const NODE_PADDING = 3;
const LABEL_GAP = 6;
const MARGIN = { top: 24, right: 220, bottom: 10, left: 170 };
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
/**
 * Target px-per-Mt for the country column (d3-sankey's global ky), so node sizes stay
 * stable across years. Height is derived so the country column hits exactly this scale
 * (see render()).
 */
const VALUE_SCALE = 0.055;
/** Minimum vertical distance between kept label centers in a column, to avoid overlap (~1.2x the 11px font-size). */
const LABEL_LINE_HEIGHT = 13;

const VALUE_FORMAT = format(',.0f');

interface NodeDatum {
  name: string;
  color: string;
}

type Node = SankeyNode<NodeDatum, object>;
type Link = SankeyLink<NodeDatum, object>;

interface RawLink {
  source: number;
  target: number;
  value: number;
}

/** Mutable accumulator while walking World -> continents -> top countries. */
interface GraphBuilder {
  nodes: NodeDatum[];
  links: RawLink[];
  indexOf: Map<string, number>;
  /** Total node count in the country column (top-N + "Other" per populated continent), for sizing the layout. */
  countryNodeCount: number;
  /** Sum of values in the country column == sum of populated continents' totals, for sizing the layout. */
  countryValueSum: number;
}

/** Sankey diagram of global CO2 emissions: World -> continents/transport -> top countries. */
export class SankeyChart {
  private readonly container: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly empty: HTMLParagraphElement;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly dataset: EmissionsDataset;
  private readonly continentColor: ScaleOrdinal<string, string>;

  constructor(parent: HTMLElement, dataset: EmissionsDataset) {
    this.dataset = dataset;
    this.continentColor = scaleOrdinal<string, string>()
      .domain(CONTINENTS.filter((c) => c !== 'Antarctica'))
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
  }

  /** Rebuild the diagram for the given year. */
  update(year: number): void {
    this.title.textContent = `Global CO₂ emissions, ${year} (million tonnes)`;
    const builder = this.buildGraph(year);
    this.empty.classList.toggle('sankey-chart__empty--hidden', builder.nodes.length > 0);
    this.render(builder);
  }

  /** Root element, used by the app to toggle visibility between base visualizations. */
  node(): HTMLDivElement {
    return this.container;
  }

  destroy(): void {
    this.container.remove();
  }

  /** World -> populated continents/transport -> top countries (+ "Other <continent>"). */
  private buildGraph(year: number): GraphBuilder {
    const builder: GraphBuilder = {
      nodes: [],
      links: [],
      indexOf: new Map(),
      countryNodeCount: 0,
      countryValueSum: 0,
    };
    const worldValue = this.dataset.valueInYear('World', year);
    if (worldValue === undefined || worldValue <= EPSILON) return builder;

    const worldIndex = this.addNode(builder, 'World', WORLD_COLOR);

    for (const name of [...CONTINENTS, ...BUNKER_ENTITIES]) {
      const value = this.dataset.valueInYear(name, year);
      if (value === undefined || value <= EPSILON) continue;

      const isBunker = (BUNKER_ENTITIES as readonly string[]).includes(name);
      const color = isBunker ? BUNKER_COLOR : this.continentColor(name);
      const index = this.addNode(builder, name, color);
      builder.links.push({ source: worldIndex, target: index, value });

      if (!isBunker) {
        builder.countryValueSum += value;
        this.addCountries(builder, name, year, index, color, value);
      }
    }

    return builder;
  }

  /** Top emitters for one continent, plus an "Other <continent>" remainder node. */
  private addCountries(
    builder: GraphBuilder,
    continent: string,
    year: number,
    parentIndex: number,
    color: string,
    continentValue: number,
  ): void {
    const countries = Object.entries(COUNTRY_TO_CONTINENT)
      .filter(([, c]) => c === continent)
      .map(([country]) => ({ country, value: this.dataset.valueInYear(country, year) }))
      .filter((c): c is { country: string; value: number } => c.value !== undefined && c.value > EPSILON)
      .sort((a, b) => b.value - a.value);

    const top = countries.slice(0, SANKEY_TOP_COUNTRIES);
    for (const { country, value } of top) {
      const index = this.addNode(builder, country, color);
      builder.links.push({ source: parentIndex, target: index, value });
      builder.countryNodeCount += 1;
    }

    const other = continentValue - top.reduce((sum, c) => sum + c.value, 0);
    if (other > EPSILON) {
      const index = this.addNode(builder, `Other ${continent}`, color);
      builder.links.push({ source: parentIndex, target: index, value: other });
      builder.countryNodeCount += 1;
    }
  }

  private addNode(builder: GraphBuilder, name: string, color: string): number {
    const existing = builder.indexOf.get(name);
    if (existing !== undefined) return existing;
    const index = builder.nodes.length;
    builder.nodes.push({ name, color });
    builder.indexOf.set(name, index);
    return index;
  }

  private render(builder: GraphBuilder): void {
    const { nodes, links } = builder;
    if (nodes.length === 0) {
      this.svg.attr('width', 0).attr('height', 0);
      return;
    }

    const width = Math.max(this.container.clientWidth, MIN_WIDTH);
    // Size the country column to exactly VALUE_SCALE px/Mt (the layout's binding ky),
    // so node sizes stay stable across years. Assumes d3-sankey's nodePadding isn't
    // capped, i.e. VALUE_SCALE * countryValueSum >= MARGIN.top + MARGIN.bottom.
    const height = Math.max(
      MIN_HEIGHT,
      VALUE_SCALE * builder.countryValueSum + (builder.countryNodeCount - 1) * NODE_PADDING,
    );
    this.svg.attr('width', width).attr('height', height);

    const layout = sankey<NodeDatum, object>()
      .nodeAlign(sankeyLeft)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .extent([
        [MARGIN.left, MARGIN.top],
        [width - MARGIN.right, height - MARGIN.bottom],
      ]);

    const graph = layout({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    });

    const visibleLabels = this.computeVisibleLabels(graph.nodes as Node[]);
    this.renderLinks(graph.links as Link[]);
    this.renderNodes(graph.nodes as Node[], visibleLabels);
  }

/*
private renderLinks(links: Link[]): void {
  const sel = this.svg
    .selectAll<SVGPathElement, Link>('path.sankey-link')
    .data(links)
    .join('path')
    .attr('class', 'sankey-link')
    .attr('d', sankeyLinkHorizontal())
    .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
    .attr('fill', 'none')                                      // ← add this
    .attr('stroke', (d) => (d.source as Node).color)          // ← was .attr('fill', ...)
    .attr('stroke-opacity', 0.4);                             // optional, conventional
*/

  private renderLinks(links: Link[]): void {
    const sel = this.svg
      .selectAll<SVGPathElement, Link>('path.sankey-link')
      .data(links)
      .join('path')
      .attr('class', 'sankey-link')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
      .attr('fill', 'none')                            
      .attr('stroke', (d) => (d.source as Node).color);

    sel
      .selectAll('title')
      .data((d) => [d])
      .join('title')
      .text((d) => `${(d.source as Node).name} → ${(d.target as Node).name}: ${this.formatValue(d.value)}`);
  }

  private renderNodes(nodes: Node[], visibleLabels: Set<Node>): void {
    const groups = this.svg
      .selectAll<SVGGElement, Node>('g.sankey-node')
      .data(nodes)
      .join('g')
      .attr('class', 'sankey-node');

    groups
      .selectAll('rect')
      .data((d) => [d])
      .join('rect')
      .attr('x', (d) => d.x0!)
      .attr('y', (d) => d.y0!)
      .attr('width', (d) => d.x1! - d.x0!)
      .attr('height', (d) => Math.max(1, d.y1! - d.y0!))
      .attr('fill', (d) => d.color);

    groups
      .selectAll('title')
      .data((d) => [d])
      .join('title')
      .text((d) => `${d.name}: ${this.formatValue(d.value ?? 0)}`);

    groups
      .selectAll<SVGTextElement, Node>('text')
      .data((d) => (visibleLabels.has(d) ? [d] : []))
      .join('text')
      .attr('class', 'sankey-label')
      .attr('x', (d) => this.labelX(d))
      .attr('y', (d) => this.labelY(d))
      .attr('text-anchor', (d) => this.labelAnchor(d))
      .attr('dy', (d) => (d.depth === 0 ? '0' : '0.35em'))
      .text((d) => `${d.name} (${this.formatValue(d.value ?? 0)})`);
  }

  /**
   * Per depth-column, keep the first node's label and any subsequent label whose center
   * is at least LABEL_LINE_HEIGHT px below the last kept label's center (avoids overlap
   * while showing as many labels as fit, unlike a per-node minimum-height check).
   */
  private computeVisibleLabels(nodes: Node[]): Set<Node> {
    const visible = new Set<Node>();
    const columns = new Map<number, Node[]>();
    for (const node of nodes) {
      const depth = node.depth ?? 0;
      const column = columns.get(depth);
      if (column) column.push(node);
      else columns.set(depth, [node]);
    }

    for (const column of columns.values()) {
      column.sort((a, b) => a.y0! - b.y0!);
      let lastCenter = -Infinity;
      for (const node of column) {
        const center = (node.y0! + node.y1!) / 2;
        if (center - lastCenter >= LABEL_LINE_HEIGHT) {
          visible.add(node);
          lastCenter = center;
        }
      }
    }

    return visible;
  }

  /** World above its node; continents to the left; countries/"Other" to the right. */
  private labelX(d: Node): number {
    if (d.depth === 0) return (d.x0! + d.x1!) / 2;
    if (d.depth === 1) return d.x0! - LABEL_GAP;
    return d.x1! + LABEL_GAP;
  }

  private labelY(d: Node): number {
    if (d.depth === 0) return d.y0! - LABEL_GAP;
    return (d.y0! + d.y1!) / 2;
  }

  private labelAnchor(d: Node): string {
    if (d.depth === 0) return 'middle';
    if (d.depth === 1) return 'end';
    return 'start';
  }

  private formatValue(value: number): string {
    return `${VALUE_FORMAT(value)} Mt`;
  }
}
