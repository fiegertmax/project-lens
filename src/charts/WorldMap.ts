import { geoNaturalEarth1, geoPath, select } from 'd3';
import type { Selection } from 'd3';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AppState } from '../state/AppState';
import { resolveOwidName } from '../data/countryNameAliases';
import type { CountryFeature } from '../data/worldGeometry';

const VIEW = { width: 960, height: 480 } as const;

/** Per-country resolution against the dataset, computed once on render. */
interface CountryDatum {
  feature: CountryFeature;
  /** OWID name; undefined when the country has no series (unselectable). */
  owidName: string | undefined;
}

/** Interactive world map: hover to label, click to (de)select a country.
 *  Reflects and drives the shared selection in AppState. */
export class WorldMap {
  private readonly state: AppState;
  private readonly dataset: EmissionsDataset;
  private readonly paths: Selection<SVGPathElement, CountryDatum, SVGGElement, unknown>;
  private readonly label: HTMLDivElement;

  constructor(container: HTMLElement, dataset: EmissionsDataset, state: AppState, features: CountryFeature[]) {
    this.dataset = dataset;
    this.state = state;

    const data = features.map((feature) => this.resolve(feature));
    const path = geoPath(geoNaturalEarth1().fitSize([VIEW.width, VIEW.height], { type: 'FeatureCollection', features }));

    const svg = select(container)
      .append('svg')
      .attr('class', 'world-map__svg')
      .attr('viewBox', `0 0 ${VIEW.width} ${VIEW.height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    this.paths = svg
      .append('g')
      .selectAll<SVGPathElement, CountryDatum>('path')
      .data(data)
      .join('path')
      .attr('class', 'world-map__country')
      .classed('world-map__country--disabled', (d) => d.owidName === undefined)
      .attr('d', (d) => path(d.feature.geometry))
      .on('pointerenter pointermove', (event, d) => this.onHover(event, d))
      .on('pointerleave', () => this.hideLabel())
      .on('click', (_event, d) => this.onClick(d));

    this.label = document.createElement('div');
    this.label.className = 'world-map__label world-map__label--hidden';
    container.appendChild(this.label);

    this.syncSelection();
    state.subscribe(() => this.syncSelection());
  }

  private resolve(feature: CountryFeature): CountryDatum {
    const owidName = resolveOwidName(feature.properties.name);
    return { feature, owidName: this.dataset.series(owidName) ? owidName : undefined };
  }

  private onHover(event: PointerEvent, d: CountryDatum): void {
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
