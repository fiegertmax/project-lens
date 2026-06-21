import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AppState } from '../state/AppState';
import { WorldMap } from '../charts/WorldMap';
import { loadCountryFeatures } from '../data/worldGeometry';

/** Full-screen popup that hosts the interactive world map for quick country
 *  selection. Geometry is fetched lazily the first time it is opened. */
export class WorldMapModal {
  private readonly dataset: EmissionsDataset;
  private readonly state: AppState;
  private readonly backdrop: HTMLDivElement;
  private readonly mapHost: HTMLDivElement;
  private loaded = false;

  constructor(dataset: EmissionsDataset, state: AppState) {
    this.dataset = dataset;
    this.state = state;

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'world-map-modal world-map-modal--hidden';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'world-map-modal__dialog';

    const header = document.createElement('div');
    header.className = 'world-map-modal__header';
    const title = document.createElement('span');
    title.className = 'world-map-modal__title';
    title.textContent = 'Select countries';
    const hint = document.createElement('span');
    hint.className = 'world-map-modal__hint';
    hint.textContent = 'Click a country to add or remove it · drag the lens onto the map to magnify small countries';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'world-map-modal__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.close());
    header.append(title, hint, closeBtn);

    this.mapHost = document.createElement('div');
    this.mapHost.className = 'world-map';

    dialog.append(header, this.mapHost);
    this.backdrop.appendChild(dialog);
    document.body.appendChild(this.backdrop);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.isHidden()) this.close();
    });
  }

  async open(): Promise<void> {
    this.backdrop.classList.remove('world-map-modal--hidden');
    if (this.loaded) return;
    this.loaded = true;
    this.mapHost.textContent = 'Loading world map…';
    const features = await loadCountryFeatures();
    this.mapHost.textContent = '';
    new WorldMap(this.mapHost, this.dataset, this.state, features);
  }

  private close(): void {
    this.backdrop.classList.add('world-map-modal--hidden');
  }

  private isHidden(): boolean {
    return this.backdrop.classList.contains('world-map-modal--hidden');
  }
}
