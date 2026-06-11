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
const NODE_PADDING = 6;
const LABEL_GAP = 6;
const MARGIN = { top: 24, right: 220, bottom: 10, left: 170 };
const MIN_WIDTH = 640;
const ROW_HEIGHT = 22;
const MIN_HEIGHT = 480;

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
    const builder: GraphBuilder = { nodes: [], links: [], indexOf: new Map() };
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

      if (!isBunker) this.addCountries(builder, name, year, index, color, value);
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
    }

    const other = continentValue - top.reduce((sum, c) => sum + c.value, 0);
    if (other > EPSILON) {
      const index = this.addNode(builder, `Other ${continent}`, color);
      builder.links.push({ source: parentIndex, target: index, value: other });
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
    const height = Math.max(MIN_HEIGHT, nodes.length * ROW_HEIGHT);
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

    this.renderLinks(graph.links as Link[]);
    this.renderNodes(graph.nodes as Node[]);
  }

  private renderLinks(links: Link[]): void {
    const sel = this.svg
      .selectAll<SVGPathElement, Link>('path.sankey-link')
      .data(links)
      .join('path')
      .attr('class', 'sankey-link')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke-width', (d) => Math.max(1, d.width ?? 1))
      .attr('fill', (d) => (d.source as Node).color);

    sel
      .selectAll('title')
      .data((d) => [d])
      .join('title')
      .text((d) => `${(d.source as Node).name} → ${(d.target as Node).name}: ${this.formatValue(d.value)}`);
  }

  private renderNodes(nodes: Node[]): void {
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
      .data((d) => [d])
      .join('text')
      .attr('class', 'sankey-label')
      .attr('x', (d) => this.labelX(d))
      .attr('y', (d) => this.labelY(d))
      .attr('text-anchor', (d) => this.labelAnchor(d))
      .attr('dy', (d) => (d.depth === 0 ? '0' : '0.35em'))
      .text((d) => `${d.name} (${this.formatValue(d.value ?? 0)})`);
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
