import { select } from 'd3';
import type { Selection } from 'd3';
import { CO2_SOURCES } from '../config';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { PieLensRecord } from '../state/PieLensState';
import { PieChart } from './PieChart';
import { PieDiagram } from './PieDiagram';
import type { PieSliceInput } from './PieDiagram';
import { countriesOfContinent, EPSILON } from './sankeyGraph';

const LENS_SIZE = 360;
const HEADER_HEIGHT = 30;
const LABEL_MARGIN = 60;
const RADIUS = (LENS_SIZE - HEADER_HEIGHT) / 2 - LABEL_MARGIN;
const FOOTNOTE_RESERVED_HEIGHT = 36;

export interface PieLensCallbacks {
  onClose(id: string): void;
  /** Pointer-down on the header — starts a drag that may end as reposition or retarget. */
  onDragStart(id: string, event: PointerEvent): void;
  /** Resolves the year to render slices for (always the current global year). */
  getYear(): number;
}

/** Floating drill-down pie chart. One instance per active lens, owned by PieLensManager.
 *  - level=country: continent target → renders the continent's countries
 *  - level=source:  country target  → renders the country's CO₂ source breakdown */
export class PieLens {
  static readonly WIDTH = LENS_SIZE;
  static readonly HEIGHT = LENS_SIZE + FOOTNOTE_RESERVED_HEIGHT;

  readonly root: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly svg: Selection<SVGSVGElement, unknown, null, undefined>;
  private readonly diagramGroup: Selection<SVGGElement, unknown, null, undefined>;
  private readonly diagram: PieDiagram;
  private readonly dataset: EmissionsDataset;
  private readonly callbacks: PieLensCallbacks;
  private record: PieLensRecord;

  constructor(parent: HTMLElement, record: PieLensRecord, dataset: EmissionsDataset, callbacks: PieLensCallbacks) {
    this.dataset = dataset;
    this.record = record;
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'pie-lens';
    this.root.dataset.lensId = record.id;
    this.root.dataset.lensLevel = record.level;
    this.root.style.width = `${LENS_SIZE}px`;
    this.root.style.height = `${LENS_SIZE - HEADER_HEIGHT + HEADER_HEIGHT + FOOTNOTE_RESERVED_HEIGHT}px`;

    const header = document.createElement('div');
    header.className = 'pie-lens__header';
    header.title = 'Drag to reposition — drop on another same-level slice to retarget';
    header.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.pie-lens__close')) return;
      this.callbacks.onDragStart(this.record.id, e);
    });

    this.title = document.createElement('span');
    this.title.className = 'pie-lens__title';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pie-lens__close';
    close.title = 'Close this lens';
    close.setAttribute('aria-label', 'Close lens');
    close.textContent = '×';
    close.addEventListener('click', () => this.callbacks.onClose(this.record.id));

    header.append(this.title, close);
    this.root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'pie-lens__body';
    this.root.appendChild(body);
    this.svg = select(body)
      .append('svg')
      .attr('class', 'pie-lens__svg')
      .attr('width', LENS_SIZE)
      .attr('height', LENS_SIZE - HEADER_HEIGHT + FOOTNOTE_RESERVED_HEIGHT);
    this.diagramGroup = this.svg.append('g').attr('class', 'pie-diagram-root');
    this.diagram = new PieDiagram(this.diagramGroup);

    parent.appendChild(this.root);
    this.applyPosition();
    this.draw();
  }

  /** Reflect a new record (position, target, level all may have changed). */
  apply(record: PieLensRecord): void {
    const targetChanged = record.target !== this.record.target || record.level !== this.record.level;
    this.record = record;
    this.root.dataset.lensLevel = record.level;
    this.applyPosition();
    if (targetChanged) this.draw();
  }

  /** Redraw the slices (e.g. when the year changed). */
  redraw(): void {
    this.draw();
  }

  /** Px position inside the overlay container (top-left). */
  position(): { x: number; y: number } {
    return this.record.position;
  }

  remove(): void {
    this.root.remove();
  }

  private applyPosition(): void {
    this.root.style.left = `${this.record.position.x}px`;
    this.root.style.top = `${this.record.position.y}px`;
  }

  private draw(): void {
    const year = this.callbacks.getYear();
    const slices = this.record.level === 'country'
      ? this.continentCountrySlices(this.record.target, year)
      : this.countrySourceSlices(this.record.target, year);

    this.title.textContent = this.record.level === 'country'
      ? `${this.record.target} — countries`
      : `${this.record.target} — emission sources`;

    this.diagramGroup.selectAll('*').remove();

    if (slices.length === 0) {
      this.diagramGroup
        .append('text')
        .attr('class', 'pie-lens__empty')
        .attr('x', LENS_SIZE / 2)
        .attr('y', (LENS_SIZE - HEADER_HEIGHT) / 2)
        .attr('text-anchor', 'middle')
        .text('No data for this entity in the selected year.');
      return;
    }

    const cx = LENS_SIZE / 2;
    const cy = (LENS_SIZE - HEADER_HEIGHT) / 2;
    const result = this.diagram.draw({ x: cx, y: cy }, RADIUS, slices);

    const footnotes: string[] = [];
    if (result.inflated.size > 0) footnotes.push('* Slice enlarged for visibility — label shows actual share.');
    if (result.hasNegatives) footnotes.push('Negative values (e.g. land-use sinks) are excluded from the pie.');
    this.diagram.drawFootnote(12, LENS_SIZE - HEADER_HEIGHT + 14, footnotes);
  }

  private continentCountrySlices(continent: string, year: number): PieSliceInput[] {
    const color = PieChart.continentColor(continent);
    return countriesOfContinent(this.dataset, continent, year).map(({ country, value }) => ({
      key: country,
      label: country,
      value,
      color,
      dataAttrs: { 'slice-level': 'country', 'slice-name': country },
    }));
  }

  private countrySourceSlices(country: string, year: number): PieSliceInput[] {
    const series = this.dataset.series(country);
    const point = series?.points.find((p) => p.year === year);
    if (!point) return [];
    const slices: PieSliceInput[] = [];
    for (const source of CO2_SOURCES) {
      const value = point.extra[source.key];
      if (!Number.isFinite(value) || value <= EPSILON) continue;
      slices.push({
        key: source.key,
        label: source.label,
        value,
        color: source.color,
        // No further drill-down past sources.
        dataAttrs: { 'slice-level': 'source', 'slice-name': source.label, 'slice-disabled': 'true' },
      });
    }
    return slices;
  }
}
