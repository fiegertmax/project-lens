import type { RawPoint } from '../data/types';
import type { YearRange } from '../state/AppState';

export type LensEffectKey = 'growth-abs' | 'growth-prct' | 'per-capita';

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
  /** Whether summing this metric across countries is meaningful (false for %). */
  accumulable: boolean;
  format(value: number): string;
  /** Derived series for the years inside window, computed from raw points. */
  compute(series: RawPoint[], window: YearRange): DerivedPoint[];
}

/** Reads one auxiliary column straight from the dataset over the lens window. */
const fromColumn = (column: string) =>
  function (series: RawPoint[], [from, to]: YearRange): DerivedPoint[] {
    const out: DerivedPoint[] = [];
    for (const point of series) {
      if (point.year < from || point.year > to) continue;
      const value = point.extra[column];
      if (!Number.isFinite(value)) continue;
      out.push({ year: point.year, value });
    }
    return out;
  };

/** Absolute year-over-year change in emissions, read from the dataset. */
const growthAbs: LensEffect = {
  key: 'growth-abs',
  label: 'Absolute growth',
  unit: 'Mt/yr',
  accumulable: true,
  format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} Mt`,
  compute: fromColumn('co2_growth_abs'),
};

/** Relative year-over-year change in emissions (%), read from the dataset. */
const growthPrct: LensEffect = {
  key: 'growth-prct',
  label: 'Relative growth',
  unit: '%',
  accumulable: false,
  format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} %`,
  compute: fromColumn('co2_growth_prct'),
};

/** Emissions per capita (tonnes/person), read straight from the dataset column. */
const perCapita: LensEffect = {
  key: 'per-capita',
  label: 'Per capita',
  unit: 't/person',
  accumulable: true,
  format: (v) => `${v.toFixed(2)} t`,
  compute: fromColumn('co2_per_capita'),
};

/** Registry of available effects; add entries to extend the lens. */
export const LENS_EFFECTS: Record<LensEffectKey, LensEffect> = {
  'growth-abs': growthAbs,
  'growth-prct': growthPrct,
  'per-capita': perCapita,
};
