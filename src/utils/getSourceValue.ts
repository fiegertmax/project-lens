import type { EmissionsDataset } from '../data/EmissionsDataset';

/**
 * Returns a country's emission source value for a specific year, or undefined
 * when the cell is absent or non-finite. Callers use this with d3 line().defined()
 * to break lines at missing years instead of filling with zero (SLOPE-04).
 */
export function getSourceValue(
  dataset: EmissionsDataset,
  country: string,
  sourceKey: string,
  year: number,
): number | undefined {
  const series = dataset.series(country);
  const point = series?.points.find((p) => p.year === year);
  if (!point) return undefined;
  const value = point.extra[sourceKey];
  return Number.isFinite(value) ? value : undefined;
}
