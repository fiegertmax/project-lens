import { pointer } from 'd3';
import type { Selection } from 'd3';
import { CO2_SOURCES } from '../config';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import { buildSourceGraph, EPSILON } from './sankeyGraph';
import { LABEL_LINE_HEIGHT, SankeyDiagram } from './SankeyDiagram';
import type { Node, SankeyExtent } from './SankeyDiagram';

const LENS_WIDTH = 460;
const LENS_HEIGHT = 360;
const LENS_MARGIN = { top: 28, right: 160, bottom: 28, left: 64 };

/** Hover lens for focused-continent mode: hovering a country node reveals
 *  an embedded Sankey breaking down its emissions by source (coal, gas, oil…). */
export class SankeySourceLens {
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly dataset: EmissionsDataset;
  private readonly group: Selection<SVGGElement, unknown, null, undefined>;
  private readonly diagram: SankeyDiagram;
  private nodes: Node[] = [];
  private year = 0;
  private active = false;

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

    svg.on('mousemove.source-lens', (event: MouseEvent) => this.handleMouseMove(event));
    svg.on('mouseleave.source-lens', () => this.hide());
  }

  /** Refresh nodes for hit-testing. `active` must be true (focused mode) for the lens to trigger. */
  update(nodes: Node[], year: number, active: boolean): void {
    this.nodes = nodes;
    this.year = year;
    this.active = active;
    this.hide();
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.active || this.nodes.length === 0) return;
    const [x, y] = pointer(event, this.svg.node());
    const maxDepth = Math.max(...this.nodes.map((n) => n.depth ?? 0));
    const hovered = this.nodes.find((n) => {
      if ((n.depth ?? 0) !== maxDepth) return false;
      if (n.name.startsWith('Other ')) return false;
      return x >= n.x0! && x <= n.x1! && y >= n.y0! && y <= n.y1!;
    });
    if (!hovered) {
      this.hide();
      return;
    }
    this.show(hovered, x, y);
  }

  private show(node: Node, x: number, y: number): void {
    const series = this.dataset.series(node.name);
    const point = series?.points.find((p) => p.year === this.year);
    const extra = point?.extra ?? {};

    const sources = CO2_SOURCES
      .map((s) => ({ label: s.label, value: extra[s.key] ?? NaN, color: s.color }))
      .filter((s) => s.value > EPSILON);

    if (sources.length === 0) {
      this.hide();
      return;
    }

    const svgWidth = Number(this.svg.attr('width'));
    const svgHeight = Number(this.svg.attr('height'));
    const left = Math.min(Math.max(x - LENS_WIDTH / 2, 0), Math.max(svgWidth - LENS_WIDTH, 0));
    const top = Math.min(Math.max(y - LENS_HEIGHT / 2, 0), Math.max(svgHeight - LENS_HEIGHT, 0));
    this.group.attr('transform', `translate(${left},${top})`).style('display', '');

    const builder = buildSourceGraph(node.name, node.color, sources);
    const extent: SankeyExtent = [
      [LENS_MARGIN.left, LENS_MARGIN.top],
      [LENS_WIDTH - LENS_MARGIN.right, LENS_HEIGHT - LENS_MARGIN.bottom],
    ];
    this.diagram.draw(builder, extent, LABEL_LINE_HEIGHT);
  }

  private hide(): void {
    this.group.style('display', 'none');
  }
}
