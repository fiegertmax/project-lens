import { pointer } from 'd3';
import type { Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { buildRootGraph, countriesOfContinent } from './sankeyGraph';
import { SankeyDiagram } from './SankeyDiagram';
import type { Node, SankeyExtent } from './SankeyDiagram';

const LENS_PREFIX = 'Other ';
/** Minimum hover hit-area height for "Other" nodes so tiny sections remain reachable. */
const MIN_HIT_HEIGHT = 12;
const LENS_WIDTH = 460;
const LENS_HEIGHT = 360;
const LENS_MARGIN = { top: 28, right: 160, bottom: 12, left: 64 };

/** Hover lens for the unfocused Sankey: hovering an "Other <continent>" node
 *  reveals an embedded Sankey of every country folded into that bucket. */
export class SankeyDetailLens {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly dataset: EmissionsDataset;
  private readonly group: Selection<SVGGElement, unknown, null, undefined>;
  private readonly diagram: SankeyDiagram;
  private nodes: Node[] = [];
  private year = 0;
  private shownCountries = new Set<string>();

  constructor(svg: Selection<SVGSVGElement, unknown, null, undefined>, dataset: EmissionsDataset) {
    this.svg = svg;
    this.dataset = dataset;
    this.group = svg.append('g').attr('class', 'sankey-lens').style('display', 'none');
    this.group
      .append('rect')
      .attr('class', 'sankey-lens__bg')
      .attr('width', LENS_WIDTH)
      .attr('height', LENS_HEIGHT);
    this.diagram = new SankeyDiagram(this.group.append('g').attr('class', 'sankey-lens__diagram'));

    svg.on('mousemove.detail-lens', (event: MouseEvent) => this.handleMouseMove(event));
    svg.on('mouseleave.detail-lens', () => this.hide());
  }

  /** Refresh the node layout this lens hit-tests against; called after every redraw.
   *  `shownCountries` is the set of country names rendered as direct nodes in the
   *  main chart — the lens shows the complement (everything else). */
  update(nodes: Node[], year: number, shownCountries: Set<string>): void {
    this.nodes = nodes;
    this.year = year;
    this.shownCountries = shownCountries;
    this.hide();
  }

  private handleMouseMove(event: MouseEvent): void {
    const [x, y] = pointer(event, this.svg.node());
    const hovered = this.nodes.find((n) => {
      if (!n.name.startsWith(LENS_PREFIX)) return false;
      const expansion = Math.max(0, (MIN_HIT_HEIGHT - (n.y1! - n.y0!)) / 2);
      return x >= n.x0! && x <= n.x1! && y >= n.y0! - expansion && y <= n.y1! + expansion;
    });
    if (!hovered) {
      this.hide();
      return;
    }

    const continent = hovered.name.slice(LENS_PREFIX.length);
    // Show exactly the countries not rendered directly in the main chart.
    const countries = countriesOfContinent(this.dataset, continent, this.year)
      .filter((c) => !this.shownCountries.has(c.country));
    if (countries.length === 0) {
      this.hide();
      return;
    }

    this.show(hovered, countries, x, y);
  }

  private show(node: Node, countries: { country: string; value: number }[], x: number, y: number): void {
    const width = Number(this.svg.attr('width'));
    const height = Number(this.svg.attr('height'));
    const left = Math.min(Math.max(x - LENS_WIDTH / 2, 0), Math.max(width - LENS_WIDTH, 0));
    const top = Math.min(Math.max(y - LENS_HEIGHT / 2, 0), Math.max(height - LENS_HEIGHT, 0));
    this.group.attr('transform', `translate(${left},${top})`).style('display', '');

    const builder = buildRootGraph(node.name, node.color, countries);
    const extent: SankeyExtent = [
      [LENS_MARGIN.left, LENS_MARGIN.top],
      [LENS_WIDTH - LENS_MARGIN.right, LENS_HEIGHT - LENS_MARGIN.bottom],
    ];
    this.diagram.draw(builder, extent);
  }

  private hide(): void {
    this.group.style('display', 'none');
  }
}
