import type { RawPoint } from '../data/types';
import type { YearRange } from '../state/AppState';

export type LensEffectKey = 'growth-rate' | 'per-capita';

/** One year of a derived effect series drawn inside the lens. */
export interface DerivedPoint {
  year: number;
  value: number;
}

/** A pluggable lens computation over the underlying data of a window (OCP seam). */
export interface LensEffect {
  key: LensEffectKey;
  label: string;
  unit: string;
  format(value: number): string;
  /** Derived series for the years inside window, computed from raw points. */
  compute(series: RawPoint[], window: YearRange): DerivedPoint[];
}

/** Year-over-year growth rate of emissions (the local derivative), in %. */
const growthRate: LensEffect = {
  key: 'growth-rate',
  label: 'Growth rate',
  unit: '%/yr',
  format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %/yr`,
  compute(series, [from, to]) {
    const out: DerivedPoint[] = [];
    let prev: number | undefined;
    for (const point of series) {
      if (!Number.isFinite(point.value)) continue;
      if (prev !== undefined && prev !== 0 && point.year >= from && point.year <= to) {
        out.push({ year: point.year, value: ((point.value - prev) / prev) * 100 });
      }
      prev = point.value;
    }
    return out;
  },
};

/** Emissions per capita (tonnes/person), read straight from the dataset column. */
const perCapita: LensEffect = {
  key: 'per-capita',
  label: 'Per capita',
  unit: 't/person',
  format: (v) => `${v.toFixed(2)} t`,
  compute(series, [from, to]) {
    const out: DerivedPoint[] = [];
    for (const point of series) {
      if (point.year < from || point.year > to) continue;
      const value = point.extra.co2_per_capita;
      if (!Number.isFinite(value)) continue;
      out.push({ year: point.year, value });
    }
    return out;
  },
};

/** Registry of available effects; add entries to extend the lens. */
export const LENS_EFFECTS: Record<LensEffectKey, LensEffect> = {
  'growth-rate': growthRate,
  'per-capita': perCapita,
};
