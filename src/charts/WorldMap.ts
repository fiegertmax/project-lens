import { geoNaturalEarth1, geoPath, select } from 'd3';
import type { GeoPath, GeoProjection, GeoStream, GeoStreamWrapper, Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AppState } from '../state/AppState';
import { resolveOwidName } from '../data/countryNameAliases';
import type { CountryFeature } from '../data/worldGeometry';
import { CircularFisheye } from './fisheye';
import { LENS_ICON } from '../ui/icons';

const VIEW = { width: 960, height: 480 } as const;
const LENS = { radius: 150, distortion: 4 } as const;

/** Per-country resolution against the dataset, computed once on render. */
interface CountryDatum {
  feature: CountryFeature;
  /** OWID name; undefined when the country has no series (unselectable). */
  owidName: string | undefined;
}

/** Interactive world map: hover to label, click to (de)select a country, plus a
 *  draggable fisheye lens that magnifies a region so small countries become easy
 *  to hit. The lens distorts the actual <path> geometry, so hover/click target the
 *  magnified positions rather than the countries' true locations. */
export class WorldMap {
  private readonly state: AppState;
  private readonly dataset: EmissionsDataset;
  private readonly svgEl: SVGSVGElement;
  private readonly projection: GeoProjection;
  private readonly basePath: GeoPath;
  private readonly paths: Selection<SVGPathElement, CountryDatum, SVGGElement, unknown>;
  private readonly lensRing: Selection<SVGCircleElement, unknown, null, undefined>;
  private readonly lensGrip: Selection<SVGCircleElement, unknown, null, undefined>;
  private readonly label: HTMLDivElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly fisheye = new CircularFisheye(LENS.radius, LENS.distortion);
  private lensActive = false;
  private lensFocus: [number, number] = [0, 0];
  private dragging = false;

  constructor(container: HTMLElement, dataset: EmissionsDataset, state: AppState, features: CountryFeature[]) {
    this.dataset = dataset;
    this.state = state;

    const data = features.map((feature) => this.resolve(feature));
    this.projection = geoNaturalEarth1().fitSize([VIEW.width, VIEW.height], { type: 'FeatureCollection', features });
    this.basePath = geoPath(this.projection);

    const svg = select(container)
      .append('svg')
      .attr('class', 'world-map__svg')
      .attr('viewBox', `0 0 ${VIEW.width} ${VIEW.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');
    this.svgEl = svg.node() as SVGSVGElement;

    this.paths = svg
      .append('g')
      .selectAll<SVGPathElement, CountryDatum>('path')
      .data(data)
      .join('path')
      .attr('class', 'world-map__country')
      .classed('world-map__country--disabled', (d) => d.owidName === undefined)
      .on('pointerenter pointermove', (event, d) => this.onHover(event, d))
      .on('pointerleave', () => this.hideLabel())
      .on('click', (_event, d) => this.onClick(d));

    this.lensRing = svg
      .append('circle')
      .attr('class', 'world-map__lens-ring world-map__lens-ring--hidden')
      .attr('r', LENS.radius);

    // Transparent grab band on the lens boundary: lets the user pick the placed
    // lens up and move it, while the interior stays free for country selection.
    this.lensGrip = svg
      .append('circle')
      .attr('class', 'world-map__lens-grip world-map__lens-grip--hidden')
      .attr('r', LENS.radius)
      .on('pointerdown', (event: PointerEvent) => this.onLensGrab(event));

    this.label = document.createElement('div');
    this.label.className = 'world-map__label world-map__label--hidden';
    container.appendChild(this.label);

    this.removeButton = this.buildToolbar(container);

    this.redraw();
    this.syncSelection();
    state.subscribe(() => this.syncSelection());
  }

  /** Lens handle (drag onto the map) + a "Remove lens" button shown when active. */
  private buildToolbar(container: HTMLElement): HTMLButtonElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'world-map__toolbar';

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'world-map__lens-handle';
    handle.setAttribute('aria-label', 'Drag the magnifier lens onto the map');
    handle.innerHTML = LENS_ICON;
    handle.addEventListener('pointerdown', (event) => this.onHandleGrab(event));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'world-map__lens-remove world-map__lens-remove--hidden';
    remove.textContent = 'Remove lens';
    remove.addEventListener('click', () => this.deactivateLens());

    toolbar.append(handle, remove);
    container.appendChild(toolbar);

    return remove;
  }

  private resolve(feature: CountryFeature): CountryDatum {
    const owidName = resolveOwidName(feature.properties.name);
    return { feature, owidName: this.dataset.series(owidName) ? owidName : undefined };
  }

  /** Grab the handle to spawn the lens; the effect appears at and follows the cursor. */
  private onHandleGrab(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const p = this.clientToViewBox(event.clientX, event.clientY);
    if (p) this.showLensAt(p);
    this.startDrag([0, 0]);
  }

  /** Grab the placed lens by its ring and move it, preserving the grab offset. */
  private onLensGrab(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const p = this.clientToViewBox(event.clientX, event.clientY);
    const offset: [number, number] = p
      ? [this.lensFocus[0] - p[0], this.lensFocus[1] - p[1]]
      : [0, 0];
    this.startDrag(offset);
  }

  /** Track the pointer, moving the live lens until release. */
  private startDrag(offset: [number, number]): void {
    this.dragging = true;
    this.hideLabel();
    const move = (event: PointerEvent): void => {
      const p = this.clientToViewBox(event.clientX, event.clientY);
      if (p) this.showLensAt([p[0] + offset[0], p[1] + offset[1]]);
    };
    const up = (): void => {
      this.dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Center the active lens at a focus point and repaint the distortion. */
  private showLensAt(focus: [number, number]): void {
    this.lensFocus = focus;
    this.fisheye.focus(focus);
    this.lensActive = true;
    for (const ring of [this.lensRing, this.lensGrip]) {
      ring.attr('cx', focus[0]).attr('cy', focus[1]);
    }
    this.lensRing.classed('world-map__lens-ring--hidden', false);
    this.lensGrip.classed('world-map__lens-grip--hidden', false);
    this.removeButton.classList.remove('world-map__lens-remove--hidden');
    this.redraw();
  }

  private deactivateLens(): void {
    this.lensActive = false;
    this.lensRing.classed('world-map__lens-ring--hidden', true);
    this.lensGrip.classed('world-map__lens-grip--hidden', true);
    this.removeButton.classList.add('world-map__lens-remove--hidden');
    this.redraw();
  }

  /** Repaint every country through the active generator (plain or fisheye). */
  private redraw(): void {
    const generator = this.lensActive ? this.fisheyePath() : this.basePath;
    this.paths.attr('d', (d) => generator(d.feature.geometry));
  }

  /** geoPath that runs the base projection (with its antimeridian clipping and
   *  resampling intact), then warps the already-projected screen points through
   *  the fisheye. Distorting after projection avoids the cross-globe streaks that
   *  geoTransform produced for polygons spanning ±180° (Fiji, Russia). */
  private fisheyePath(): GeoPath {
    const projection = this.projection;
    const fisheye = this.fisheye;
    const wrapper: GeoStreamWrapper = {
      stream(output: GeoStream): GeoStream {
        return projection.stream({
          point(x: number, y: number): void {
            const f = fisheye.apply(x, y);
            output.point(f.x, f.y);
          },
          lineStart: () => output.lineStart(),
          lineEnd: () => output.lineEnd(),
          polygonStart: () => output.polygonStart(),
          polygonEnd: () => output.polygonEnd(),
          sphere: () => output.sphere?.(),
        });
      },
    };
    return geoPath(wrapper);
  }

  /** Convert viewport coords to viewBox coords, or null if outside the map area. */
  private clientToViewBox(clientX: number, clientY: number): [number, number] | null {
    const ctm = this.svgEl.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    if (pt.x < 0 || pt.y < 0 || pt.x > VIEW.width || pt.y > VIEW.height) return null;
    return [pt.x, pt.y];
  }

  private onHover(event: PointerEvent, d: CountryDatum): void {
    if (this.dragging) return;
    const name = d.owidName ?? d.feature.properties.name;
    this.label.textContent = d.owidName ? name : `${name} — no data`;
    this.label.classList.remove('world-map__label--hidden');
    this.label.style.left = `${event.clientX}px`;
    this.label.style.top = `${event.clientY}px`;
  }

  private hideLabel(): void {
    this.label.classList.add('world-map__label--hidden');
  }

  private onClick(d: CountryDatum): void {
    if (d.owidName) this.state.toggleCountry(d.owidName);
  }

  private syncSelection(): void {
    this.paths.classed('world-map__country--selected', (d) =>
      d.owidName !== undefined && this.state.isSelected(d.owidName),
    );
  }
}
