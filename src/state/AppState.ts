export type YearRange = [number, number];

/** Which base visualization is active in the main area. */
export type BaseVisualizationTab = 'by-country' | 'global';

/** Which sub-visualization is shown inside the "global" tab. */
export type GlobalVizMode = 'sankey' | 'pie';

type Listener = () => void;

/** Observable single source of truth for the view configuration. */
export class AppState {
  private readonly selected: Set<string>;
  private range: YearRange;
  private tab: BaseVisualizationTab = 'by-country';
  private year: number;
  private focusContinent: string | null = null;
  private vizMode: GlobalVizMode = 'sankey';
  private readonly listeners = new Set<Listener>();

  constructor(selectedCountries: Iterable<string>, yearRange: YearRange, globalYear: number) {
    this.selected = new Set(selectedCountries);
    this.range = yearRange;
    this.year = globalYear;
  }

  selectedCountries(): string[] {
    return [...this.selected];
  }

  isSelected(country: string): boolean {
    return this.selected.has(country);
  }

  yearRange(): YearRange {
    return this.range;
  }

  toggleCountry(country: string): void {
    if (this.selected.has(country)) this.selected.delete(country);
    else this.selected.add(country);
    this.notify();
  }

  setYearRange(range: YearRange): void {
    if (range[0] === this.range[0] && range[1] === this.range[1]) return;
    this.range = range;
    this.notify();
  }

  activeTab(): BaseVisualizationTab {
    return this.tab;
  }

  setActiveTab(tab: BaseVisualizationTab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.notify();
  }

  globalYear(): number {
    return this.year;
  }

  setGlobalYear(year: number): void {
    if (year === this.year) return;
    this.year = year;
    this.notify();
  }

  focusedContinent(): string | null {
    return this.focusContinent;
  }

  setFocusedContinent(continent: string | null): void {
    if (continent === this.focusContinent) return;
    this.focusContinent = continent;
    this.notify();
  }

  globalVizMode(): GlobalVizMode {
    return this.vizMode;
  }

  setGlobalVizMode(mode: GlobalVizMode): void {
    if (mode === this.vizMode) return;
    this.vizMode = mode;
    this.notify();
  }

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
