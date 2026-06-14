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
/** Minimum vertical distance between kept label centers in a column, to avoid overlap (~1.2x the 11px font-size).
 *  Also exported so callers can pass it as `minNodeHeight` to `draw()` to guarantee all nodes are labeled. */
export const LABEL_LINE_HEIGHT = 13;
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
   *  nodes (with x0/x1/y0/y1/depth) for hit-testing by callers.
   *
   *  When `minNodeHeight > 0` (e.g. pass `LABEL_LINE_HEIGHT`), any link whose
   *  natural pixel height would fall below that threshold has its value inflated
   *  so the rendered node is at least that tall and can carry a label. */
  draw(builder: GraphBuilder, extent: SankeyExtent, minNodeHeight = 0): Node[] {
    const { nodes } = builder;
    if (nodes.length === 0) {
      this.target.selectAll('*').remove();
      return [];
    }

    // Capture original (pre-inflation) values per node name so labels and tooltips
    // always reflect real data even after links are inflated for visual minimum height.
    // For leaves: incoming link value; for root: sum of all outgoing link values.
    const originalValues = new Map<string, number>();
    const inflatedNodeNames = new Set<string>();

    let effectiveLinks = builder.links;
    if (minNodeHeight > 0) {
      for (const link of builder.links) {
        const tgt = builder.nodes[link.target]?.name;
        if (tgt) originalValues.set(tgt, link.value);
        const src = builder.nodes[link.source]?.name;
        if (src) originalValues.set(src, (originalValues.get(src) ?? 0) + link.value);
      }

      const previewNodes = this.layoutOnly(builder, extent);
      const ky = SankeyDiagram.estimateKy(previewNodes);
      if (ky > 0) {
        const minValue = minNodeHeight / ky;
        effectiveLinks = builder.links.map((l) => {
          if (l.value < minValue) {
            const tgt = builder.nodes[l.target]?.name;
            if (tgt) inflatedNodeNames.add(tgt);
            return { ...l, value: minValue };
          }
          return l;
        });
      }
    }

    const layout = sankey<NodeDatum, object>()
      .nodeAlign(sankeyLeft)
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeSort(null)
      .extent(extent);

    const graph = layout({
      nodes: nodes.map((n) => ({ ...n })),
      links: effectiveLinks.map((l) => ({ ...l })),
    });

    const graphNodes = graph.nodes as Node[];
    const maxDepth = Math.max(...graphNodes.map((n) => n.depth ?? 0));

    const visibleLabels = computeVisibleLabels(graphNodes);
    this.renderLinks(graph.links as Link[], originalValues);
    this.renderNodes(graphNodes, visibleLabels, maxDepth, inflatedNodeNames, originalValues);
    this.renderFootnote(extent, inflatedNodeNames.size > 0);

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

  private renderLinks(links: Link[], originalValues: Map<string, number>): void {
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
      .text((d) => {
        const tgt = (d.target as Node).name;
        const val = originalValues.get(tgt) ?? d.value;
        return `${(d.source as Node).name} → ${tgt}: ${formatValue(val)}`;
      });
  }

  private renderNodes(
    nodes: Node[],
    visibleLabels: Set<Node>,
    maxDepth: number,
    inflatedNodeNames: Set<string>,
    originalValues: Map<string, number>,
  ): void {
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
      .text((d) => {
        const val = originalValues.get(d.name) ?? d.value ?? 0;
        return `${d.name}: ${formatValue(val)}`;
      });

    groups
      .selectAll<SVGTextElement, Node>('text')
      .data((d) => (visibleLabels.has(d) ? [d] : []))
      .join('text')
      .attr('class', 'sankey-label')
      .attr('x', (d) => this.labelX(d, maxDepth))
      .attr('y', (d) => this.labelY(d))
      .attr('text-anchor', (d) => this.labelAnchor(d, maxDepth))
      .attr('dy', (d) => (d.depth === 0 ? '0' : '0.35em'))
      .text((d) => {
        const val = originalValues.get(d.name) ?? d.value ?? 0;
        const marker = inflatedNodeNames.has(d.name) ? '*' : '';
        return `${d.name}${marker} (${formatValue(val)})`;
      });
  }

  private renderFootnote(extent: SankeyExtent, show: boolean): void {
    this.target
      .selectAll<SVGTextElement, true>('text.sankey-footnote')
      .data(show ? [true as const] : [])
      .join('text')
      .attr('class', 'sankey-footnote')
      .attr('x', extent[0][0])
      .attr('y', extent[1][1] + 14)
      .text('* Bar enlarged for visibility — label shows actual value');
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

  /** Extract the global ky (px per value unit) from any node with positive height and value. */
  private static estimateKy(nodes: Node[]): number {
    let best: Node | undefined;
    for (const n of nodes) {
      if ((n.value ?? 0) > 0 && n.y1! - n.y0! > 0) {
        if (!best || (n.value ?? 0) > (best.value ?? 0)) best = n;
      }
    }
    return best ? (best.y1! - best.y0!) / best.value! : 0;
  }
}
