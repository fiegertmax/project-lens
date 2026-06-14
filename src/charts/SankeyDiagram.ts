import { format } from 'd3';
import type { Selection } from 'd3';
import { sankey, sankeyLeft, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyLink, SankeyNode } from 'd3-sankey';
import type { GraphBuilder, NodeDatum } from './sankeyGraph';

export type Node = SankeyNode<NodeDatum, object>;
export type Link = SankeyLink<NodeDatum, object>;
export type SankeyExtent = [[number, number], [number, number]];

const NODE_WIDTH = 16;
const NODE_PADDING = 3;
const LABEL_GAP = 6;
/** Minimum vertical distance between kept label centers in a column, to avoid overlap (~1.2x the 11px font-size). */
const LABEL_LINE_HEIGHT = 13;
/** "Other <continent>" nodes get at least this many px of visual height/stroke so they are findable. */
const MIN_OTHER_VISUAL_HEIGHT = 6;
const OTHER_PREFIX = 'Other ';

const VALUE_FORMAT = format(',.0f');

export function formatValue(value: number): string {
  return `${VALUE_FORMAT(value)} Mt`;
}

/**
 * Per depth-column, keep the first node's label and any subsequent label whose center
 * is at least LABEL_LINE_HEIGHT px below the last kept label's center. "Other X" nodes
 * are always included and advance the cursor so the next continent's label stays clear.
 * Exported so callers can do a dry-run on a first-pass layout before rebuilding.
 */
export function computeVisibleLabels(nodes: Node[]): Set<Node> {
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
      if (node.name.startsWith(OTHER_PREFIX)) {
        visible.add(node);
        lastCenter = (node.y0! + node.y1!) / 2;
        continue;
      }
      const center = (node.y0! + node.y1!) / 2;
      if (center - lastCenter >= LABEL_LINE_HEIGHT) {
        visible.add(node);
        lastCenter = center;
      }
    }
  }

  return visible;
}

/** Renders one Sankey graph (layout + links + nodes + labels) into a <g>.
 *  Shared by the main chart and the "Other <continent>" detail lens. */
export class SankeyDiagram {
  private readonly target: Selection<SVGGElement, unknown, null, undefined>;

  constructor(target: Selection<SVGGElement, unknown, null, undefined>) {
    this.target = target;
  }

  /** Lays out and draws `builder` into the target group. Returns the laid-out
   *  nodes (with x0/x1/y0/y1/depth) for hit-testing by callers. */
  draw(builder: GraphBuilder, extent: SankeyExtent): Node[] {
    const { nodes, links } = builder;
    if (nodes.length === 0) {
      this.target.selectAll('*').remove();
      return [];
    }

    const layout = sankey<NodeDatum, object>()
      .nodeAlign(sankeyLeft)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeSort(null)
      .extent(extent);

    const graph = layout({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    });

    const graphNodes = graph.nodes as Node[];
    const maxDepth = Math.max(...graphNodes.map((n) => n.depth ?? 0));

    const visibleLabels = computeVisibleLabels(graphNodes);
    this.renderLinks(graph.links as Link[]);
    this.renderNodes(graphNodes, visibleLabels, maxDepth);

    return graphNodes;
  }

  /** Compute layout without rendering; used for a first-pass ky estimate before rebuilding. */
  layoutOnly(builder: GraphBuilder, extent: SankeyExtent): Node[] {
    const { nodes, links } = builder;
    if (nodes.length === 0) return [];
    const layout = sankey<NodeDatum, object>()
      .nodeAlign(sankeyLeft)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeSort(null)
      .extent(extent);
    const graph = layout({
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    });
    return graph.nodes as Node[];
  }

  private renderLinks(links: Link[]): void {
    const sel = this.target
      .selectAll<SVGPathElement, Link>('path.sankey-link')
      .data(links)
      .join('path')
      .attr('class', 'sankey-link')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke-width', (d) => {
        const isOther = (d.target as Node).name.startsWith(OTHER_PREFIX);
        return Math.max(isOther ? MIN_OTHER_VISUAL_HEIGHT : 1, d.width ?? 1);
      })
      .attr('fill', 'none')
      .attr('stroke', (d) => (d.source as Node).color);

    sel
      .selectAll('title')
      .data((d) => [d])
      .join('title')
      .text((d) => `${(d.source as Node).name} → ${(d.target as Node).name}: ${formatValue(d.value)}`);
  }

  private renderNodes(nodes: Node[], visibleLabels: Set<Node>, maxDepth: number): void {
    const groups = this.target
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
      .attr('height', (d) => Math.max(d.name.startsWith(OTHER_PREFIX) ? MIN_OTHER_VISUAL_HEIGHT : 1, d.y1! - d.y0!))
      .attr('fill', (d) => d.color);

    groups
      .selectAll('title')
      .data((d) => [d])
      .join('title')
      .text((d) => `${d.name}: ${formatValue(d.value ?? 0)}`);

    groups
      .selectAll<SVGTextElement, Node>('text')
      .data((d) => (visibleLabels.has(d) ? [d] : []))
      .join('text')
      .attr('class', 'sankey-label')
      .attr('x', (d) => this.labelX(d, maxDepth))
      .attr('y', (d) => this.labelY(d))
      .attr('text-anchor', (d) => this.labelAnchor(d, maxDepth))
      .attr('dy', (d) => (d.depth === 0 ? '0' : '0.35em'))
      .text((d) => `${d.name} (${formatValue(d.value ?? 0)})`);
  }

  /** Root above its own left edge (aligned with the heading); middle columns to the
   *  left of theirs; the last (leaf) column to the right. */
  private labelX(d: Node, maxDepth: number): number {
    if (d.depth === 0) return d.x0!;
    if (d.depth === maxDepth) return d.x1! + LABEL_GAP;
    return d.x0! - LABEL_GAP;
  }

  private labelY(d: Node): number {
    if (d.depth === 0) return d.y0! - LABEL_GAP;
    return (d.y0! + d.y1!) / 2;
  }

  private labelAnchor(d: Node, maxDepth: number): string {
    if (d.depth === 0 || d.depth === maxDepth) return 'start';
    return 'end';
  }
}
