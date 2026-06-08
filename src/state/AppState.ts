export type YearRange = [number, number];

type Listener = () => void;

/** Observable single source of truth for the view configuration. */
export class AppState {
  private readonly selected: Set<string>;
  private range: YearRange;
  private readonly listeners = new Set<Listener>();

  constructor(selectedCountries: Iterable<string>, yearRange: YearRange) {
    this.selected = new Set(selectedCountries);
    this.range = yearRange;
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

  /** Subscribe to changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
