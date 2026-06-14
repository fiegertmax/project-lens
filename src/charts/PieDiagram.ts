import { arc, format, pie } from 'd3';
import type { Arc, PieArcDatum, Selection } from 'd3';

interface SliceDatum {
  input: PieSliceInput;
  display: number;
  original: number;
}
type SliceArc = PieArcDatum<SliceDatum>;

export interface PieSliceInput {
  /** Stable identifier used for hit-testing (drag drop targets). */
  key: string;
  /** Label rendered next to the slice. */
  label: string;
  /** Actual value (million tonnes); negatives are filtered before rendering. */
  value: number;
  /** Slice fill color. */
  color: string;
  /** Per-slice DOM dataset entries (e.g. data-slice-level, data-slice-disabled). */
  dataAttrs?: Record<string, string>;
}

export interface PieDrawResult {
  /** Names of slices whose angle was inflated above the minimum. */
  inflated: Set<string>;
  /** Whether anything was rendered at all. */
  rendered: boolean;
  /** True if any input slice had value <= 0 and was filtered. */
  hasNegatives: boolean;
}

const VALUE_FORMAT = format(',.1f');
const PERCENT_FORMAT = format('.1%');

/** Minimum on-screen radians a slice gets so its label can render. */
const DEFAULT_MIN_SLICE_ANGLE = (Math.PI * 2) * (3 / 360); // 3 degrees
/** Vertical pixel spacing between adjacent outside labels in one column. */
const LABEL_LINE_HEIGHT = 14;
/** Padding between the slice arc and the polyline elbow. */
const LABEL_ELBOW_PAD = 8;

export function formatMt(value: number): string {
  return `${VALUE_FORMAT(value)} Mt`;
}

/** Renders one pie chart (slices + labels + footnote) into a <g>. Re-used by both
 *  the base pie chart and every floating lens pie. Small slices below `minSliceAngle`
 *  are visually inflated to stay clickable/labelable; the original values are kept
 *  for tooltips/labels and a footnote signals the distortion. */
export class PieDiagram {
  private readonly target: Selection<SVGGElement, unknown, null, undefined>;

  constructor(target: Selection<SVGGElement, unknown, null, undefined>) {
    this.target = target;
  }

  /** @param center px coordinates of the pie center inside the target group
   *  @param radius outer radius
   *  @param slices input slices (negatives are filtered)
   *  @param minSliceAngle radians; defaults to 3 degrees */
  draw(
    center: { x: number; y: number },
    radius: number,
    slices: PieSliceInput[],
    minSliceAngle = DEFAULT_MIN_SLICE_ANGLE,
  ): PieDrawResult {
    const positive = slices.filter((s) => s.value > 0 && Number.isFinite(s.value));
    const hasNegatives = slices.length !== positive.length;

    this.target.selectAll('*').remove();
    if (positive.length === 0) {
      return { inflated: new Set(), rendered: false, hasNegatives };
    }

    const total = positive.reduce((sum, s) => sum + s.value, 0);
    const inflated = new Set<string>();
    const displayValues = computeDisplayValues(positive, total, minSliceAngle, inflated);

    const arcs: SliceArc[] = pie<SliceDatum>()
      .value((d) => d.display)
      .sort(null)(
      positive.map((input, i) => ({ input, display: displayValues[i], original: input.value })),
    );

    const innerArc: Arc<unknown, SliceArc> = arc<SliceArc>()
      .innerRadius(0)
      .outerRadius(radius);

    const labelArc: Arc<unknown, SliceArc> = arc<SliceArc>()
      .innerRadius(radius * 0.65)
      .outerRadius(radius * 0.65);

    const group = this.target
      .append('g')
      .attr('class', 'pie-diagram')
      .attr('transform', `translate(${center.x}, ${center.y})`);

    this.renderSlices(group, arcs, innerArc, inflated, total);
    this.renderLabels(group, arcs, labelArc, radius, inflated, total);

    return { inflated, rendered: true, hasNegatives };
  }

  /** Render a footnote line below the pie when slices were inflated. */
  drawFootnote(x: number, y: number, lines: string[]): void {
    this.target.selectAll<SVGTextElement, true>('text.pie-footnote').remove();
    if (lines.length === 0) return;
    const text = this.target
      .append('text')
      .attr('class', 'pie-footnote')
      .attr('x', x)
      .attr('y', y);
    lines.forEach((line, i) => {
      text
        .append('tspan')
        .attr('x', x)
        .attr('dy', i === 0 ? 0 : LABEL_LINE_HEIGHT)
        .text(line);
    });
  }

  private renderSlices(
    group: Selection<SVGGElement, unknown, null, undefined>,
    arcs: SliceArc[],
    innerArc: Arc<unknown, SliceArc>,
    inflated: Set<string>,
    total: number,
  ): void {
    const sliceGroups = group
      .selectAll<SVGGElement, SliceArc>('g.pie-slice')
      .data(arcs)
      .join('g')
      .attr('class', (d) =>
        ['pie-slice', inflated.has(d.data.input.key) ? 'pie-slice--inflated' : ''].filter(Boolean).join(' '),
      )
      .each(function (d) {
        const node = this as SVGGElement;
        node.dataset.sliceKey = d.data.input.key;
        for (const [k, v] of Object.entries(d.data.input.dataAttrs ?? {})) {
          node.dataset[toCamel(k)] = v;
        }
      });

    sliceGroups
      .append('path')
      .attr('d', innerArc)
      .attr('fill', (d) => d.data.input.color)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1);

    sliceGroups
      .append('title')
      .text((d) => {
        const marker = inflated.has(d.data.input.key) ? '* ' : '';
        const pct = PERCENT_FORMAT(d.data.original / total);
        return `${marker}${d.data.input.label}: ${formatMt(d.data.original)} (${pct})`;
      });
  }

  /** Inside-label for big slices, polyline+outside label for small ones, with
   *  greedy vertical de-overlap per side so labels remain readable. */
  private renderLabels(
    group: Selection<SVGGElement, unknown, null, undefined>,
    arcs: SliceArc[],
    labelArc: Arc<unknown, SliceArc>,
    radius: number,
    inflated: Set<string>,
    total: number,
  ): void {
    const insideThreshold = (Math.PI * 2) * 0.06; // ~6% of the pie
    const outsideRadius = radius + 16;

    type Annotated = {
      arc: SliceArc;
      angle: number;
      onRight: boolean;
      y: number;
      x: number;
    };

    const inside: Annotated[] = [];
    const outside: Annotated[] = [];
    for (const a of arcs) {
      const angle = (a.startAngle + a.endAngle) / 2;
      const onRight = Math.sin(angle) >= 0;
      const y = -Math.cos(angle) * outsideRadius;
      const x = Math.sin(angle) * outsideRadius;
      const annotated: Annotated = { arc: a, angle, onRight, y, x };
      if (a.endAngle - a.startAngle >= insideThreshold) inside.push(annotated);
      else outside.push(annotated);
    }

    // Inside labels
    for (const a of inside) {
      const [cx, cy] = labelArc.centroid(a.arc);
      const label = group
        .append('text')
        .attr('class', 'pie-label pie-label--inside')
        .attr('x', cx)
        .attr('y', cy)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em');
      const marker = inflated.has(a.arc.data.input.key) ? '*' : '';
      const pct = PERCENT_FORMAT(a.arc.data.original / total);
      label.append('tspan').attr('x', cx).text(`${a.arc.data.input.label}${marker}`);
      label.append('tspan').attr('x', cx).attr('dy', LABEL_LINE_HEIGHT).text(pct);
    }

    // Outside labels: greedy de-overlap per side, top-to-bottom.
    const placeSide = (items: Annotated[]): Annotated[] => {
      const sorted = [...items].sort((a, b) => a.y - b.y);
      let lastY = -Infinity;
      const kept: Annotated[] = [];
      for (const item of sorted) {
        const minY = lastY + LABEL_LINE_HEIGHT;
        const y = Math.max(item.y, minY);
        item.y = y;
        kept.push(item);
        lastY = y;
      }
      return kept;
    };

    const right = placeSide(outside.filter((o) => o.onRight));
    const left = placeSide(outside.filter((o) => !o.onRight));

    for (const a of [...right, ...left]) {
      const sliceX = Math.sin(a.angle) * radius;
      const sliceY = -Math.cos(a.angle) * radius;
      const elbowX = Math.sin(a.angle) * (radius + LABEL_ELBOW_PAD);
      const elbowY = a.y;
      const textX = a.onRight ? elbowX + 6 : elbowX - 6;

      group
        .append('polyline')
        .attr('class', 'pie-leader')
        .attr('fill', 'none')
        .attr('stroke', '#6b6375')
        .attr('stroke-width', 0.75)
        .attr('points', `${sliceX},${sliceY} ${elbowX},${elbowY} ${textX},${elbowY}`);

      const marker = inflated.has(a.arc.data.input.key) ? '*' : '';
      const pct = PERCENT_FORMAT(a.arc.data.original / total);
      group
        .append('text')
        .attr('class', 'pie-label pie-label--outside')
        .attr('x', textX)
        .attr('y', elbowY)
        .attr('text-anchor', a.onRight ? 'start' : 'end')
        .attr('dy', '0.35em')
        .text(`${a.arc.data.input.label}${marker} (${pct})`);
    }
  }
}

/** Compute display values: any slice below `minAngle` gets bumped up; larger slices
 *  are scaled down proportionally so the total stays constant. Mirrors Sankey's
 *  small-area inflation in SankeyDiagram.draw(). */
function computeDisplayValues(
  slices: PieSliceInput[],
  total: number,
  minAngle: number,
  inflated: Set<string>,
): number[] {
  if (total <= 0) return slices.map(() => 0);

  const minShare = minAngle / (Math.PI * 2);
  const minValue = minShare * total;

  // Iteratively pin small slices to minValue; rescale the rest until stable.
  const pinned = new Array<boolean>(slices.length).fill(false);
  let changed = true;
  while (changed) {
    changed = false;
    const pinnedSum = pinned.reduce((sum, p) => (p ? sum + minValue : sum), 0);
    const freeSum = slices.reduce((sum, slice, i) => (pinned[i] ? sum : sum + slice.value), 0);
    const remaining = total - pinnedSum;
    if (remaining <= 0 || freeSum <= 0) break;
    const scale = remaining / freeSum;
    for (let i = 0; i < slices.length; i++) {
      if (pinned[i]) continue;
      if (slices[i].value * scale < minValue) {
        pinned[i] = true;
        inflated.add(slices[i].key);
        changed = true;
      }
    }
  }

  const pinnedSum = pinned.reduce((sum, p) => (p ? sum + minValue : sum), 0);
  const freeSum = slices.reduce((sum, slice, i) => (pinned[i] ? sum : sum + slice.value), 0);
  const remaining = Math.max(0, total - pinnedSum);
  const scale = freeSum > 0 ? remaining / freeSum : 0;
  return slices.map((s, i) => (pinned[i] ? minValue : s.value * scale));
}

function toCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}
