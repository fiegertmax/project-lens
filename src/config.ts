import type { MetricDefinition, MetricKey } from './data/types';
import type { LensEffectKey } from './lens/effects';

/** Runtime URL of the dataset, served from public/. */
export const DATA_URL = `${import.meta.env.BASE_URL}data/owid-co2-data.csv`;

/** Entities shown on first load (names as stored in the dataset). */
export const DEFAULT_COUNTRIES: readonly string[] = [
  'Germany',
  'United States',
  'China',
  'Russia',
  'India',
];

/** Requested 1950–2025; the dataset ends at 2024, so the max is clamped on load. */
export const DEFAULT_YEAR_RANGE: readonly [number, number] = [1950, 2025];

/** Metric extension point: add entries here to expose new measures (OCP). */
export const METRICS: Record<MetricKey, MetricDefinition> = {
  co2: {
    key: 'co2',
    column: 'co2',
    label: 'Annual CO₂ emissions',
    unit: 'million tonnes',
  },
};

export const DEFAULT_METRIC: MetricDefinition = METRICS.co2;

/** Auxiliary columns retained for lens effects (e.g. per-capita). */
export const EXTRA_COLUMNS: readonly string[] = ['population'];

/** Lens window width bounds and default, in years. */
export const LENS_WIDTH = { min: 3, max: 40, default: 10 };

export const DEFAULT_LENS_EFFECT: LensEffectKey = 'growth-rate';
