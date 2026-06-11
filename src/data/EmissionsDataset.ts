import { csv } from 'd3';
import type { DSVRowString } from 'd3';
import type { CountrySeries, MetricDefinition } from './types';

/** Loads and indexes the OWID CO₂ dataset for a single metric. */
export class EmissionsDataset {
  private readonly byCountry: Map<string, CountrySeries>;
  private readonly sortedCountries: string[];
  private readonly extent: [number, number];

  private constructor(byCountry: Map<string, CountrySeries>) {
    this.byCountry = byCountry;
    this.sortedCountries = [...byCountry.keys()].sort((a, b) =>
      a.localeCompare(b),
    );
    this.extent = EmissionsDataset.computeYearExtent(byCountry);
  }

  /** Fetch the CSV and index it by country for the metric plus extra columns. */
  static async load(
    url: string,
    metric: MetricDefinition,
    extraColumns: readonly string[] = [],
  ): Promise<EmissionsDataset> {
    const rows = await csv(url);
    return new EmissionsDataset(
      EmissionsDataset.index(rows, metric, extraColumns),
    );
  }

  /** All entity names, sorted alphabetically. */
  countries(): string[] {
    return this.sortedCountries;
  }

  /** Raw series for one country, or undefined if absent. */
  series(country: string): CountrySeries | undefined {
    return this.byCountry.get(country);
  }

  /** [minYear, maxYear] spanning every observation in the dataset. */
  yearExtent(): [number, number] {
    return this.extent;
  }

  /** This entity's value in a given year, or undefined if absent/missing. */
  valueInYear(entity: string, year: number): number | undefined {
    const point = this.series(entity)?.points.find((p) => p.year === year);
    return point && Number.isFinite(point.value) ? point.value : undefined;
  }

  private static index(
    rows: DSVRowString[],
    metric: MetricDefinition,
    extraColumns: readonly string[],
  ): Map<string, CountrySeries> {
    const byCountry = new Map<string, CountrySeries>();
    for (const row of rows) {
      const country = row.country;
      const year = Number(row.year);
      if (!country || !Number.isFinite(year)) continue;

      const series = EmissionsDataset.ensureSeries(byCountry, country);
      series.points.push({
        year,
        value: EmissionsDataset.parse(row, metric.column),
        extra: EmissionsDataset.parseExtra(row, extraColumns),
      });
    }
    for (const series of byCountry.values()) {
      series.points.sort((a, b) => a.year - b.year);
    }
    return byCountry;
  }

  private static ensureSeries(
    byCountry: Map<string, CountrySeries>,
    country: string,
  ): CountrySeries {
    let series = byCountry.get(country);
    if (!series) {
      series = { country, points: [] };
      byCountry.set(country, series);
    }
    return series;
  }

  /** Empty cells become NaN so missing years can be detected downstream. */
  private static parse(row: DSVRowString, column: string): number {
    const raw = row[column];
    return raw === undefined || raw === '' ? NaN : Number(raw);
  }

  private static parseExtra(
    row: DSVRowString,
    columns: readonly string[],
  ): Record<string, number> {
    const extra: Record<string, number> = {};
    for (const column of columns) extra[column] = EmissionsDataset.parse(row, column);
    return extra;
  }

  private static computeYearExtent(
    byCountry: Map<string, CountrySeries>,
  ): [number, number] {
    let min = Infinity;
    let max = -Infinity;
    for (const { points } of byCountry.values()) {
      for (const point of points) {
        if (point.year < min) min = point.year;
        if (point.year > max) max = point.year;
      }
    }
    return [min, max];
  }
}
