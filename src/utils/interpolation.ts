import type { CountrySeries, DataPoint, RawPoint } from '../data/types';

/**
 * Resolve a raw series into renderable points within [minYear, maxYear].
 * Real values pass through. A gap year flanked by real values on both sides
 * (anywhere in the series, not just the visible range) is filled with the
 * midpoint of its nearest neighbours and flagged isMissing. Leading/trailing
 * gaps with no neighbour on one side are omitted.
 *
 * When extraColumn is set, values are read from point.extra[extraColumn]
 * instead of point.value (e.g. 'co2' to show fossil-only emissions).
 */
export function resolveSeries(
  series: CountrySeries,
  [minYear, maxYear]: [number, number],
  extraColumn?: string,
): DataPoint[] {
  const getValue = (p: RawPoint): number =>
    extraColumn !== undefined ? p.extra[extraColumn] : p.value;

  const real = series.points.filter((p) => Number.isFinite(getValue(p)));
  if (real.length === 0) return [];

  const valueByYear = new Map(real.map((p) => [p.year, getValue(p)]));
  const firstYear = real[0].year;
  const lastYear = real[real.length - 1].year;

  const resolved: DataPoint[] = [];
  for (let year = minYear; year <= maxYear; year++) {
    const value = valueByYear.get(year);
    if (value !== undefined) {
      resolved.push({ year, value, isMissing: false });
    } else if (year > firstYear && year < lastYear) {
      const prev = nearestValue(valueByYear, year - 1, -1, firstYear);
      const next = nearestValue(valueByYear, year + 1, 1, lastYear);
      resolved.push({ year, value: (prev + next) / 2, isMissing: true });
    }
  }
  return resolved;
}

/** Nearest real value scanning from start toward bound; bound is guaranteed real. */
function nearestValue(
  valueByYear: Map<number, number>,
  start: number,
  step: number,
  bound: number,
): number {
  for (let year = start; ; year += step) {
    const value = valueByYear.get(year);
    if (value !== undefined) return value;
    if (year === bound) return valueByYear.get(bound) as number;
  }
}
