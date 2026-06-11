import type { DerivedPoint } from './effects';

export type CombineKind = 'accumulate' | 'mean';

/** Combine several countries' derived series into one, summing or averaging per year.
 *  Mean divides by the number of countries that actually have a value that year. */
export function combineSeries(
  perCountry: DerivedPoint[][],
  kind: CombineKind,
): DerivedPoint[] {
  const sums = new Map<number, { total: number; count: number }>();
  for (const series of perCountry)
    for (const { year, value } of series) {
      if (!Number.isFinite(value)) continue;
      const bucket = sums.get(year) ?? { total: 0, count: 0 };
      bucket.total += value;
      bucket.count += 1;
      sums.set(year, bucket);
    }

  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, { total, count }]) => ({
      year,
      value: kind === 'mean' ? total / count : total,
    }));
}
