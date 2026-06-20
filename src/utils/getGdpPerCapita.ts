import type { RawPoint } from '../data/types';

/**
 * Derives GDP per capita from a raw data point's extra columns.
 * Returns a finite number or undefined — never NaN or Infinity — so callers
 * can safely pass the result to D3 scale domains without poisoning them with
 * non-finite values (GDP-01). Rows with missing, zero, or non-finite operands
 * are silently excluded; callers use undefined to skip the point.
 */
export function getGdpPerCapita(point: RawPoint): number | undefined {
  const gdp = point.extra['gdp'];
  const population = point.extra['population'];
  if (!Number.isFinite(gdp)) return undefined;
  if (!Number.isFinite(population)) return undefined;
  if (population === 0) return undefined;
  const result = gdp / population;
  return Number.isFinite(result) ? result : undefined;
}
