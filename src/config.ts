import type { MetricDefinition, MetricKey } from './data/types';
import type { LensEffectKey } from './lens/effects';

/** Runtime URL of the dataset, served from public/. */
export const DATA_URL = `${import.meta.env.BASE_URL}data/owid-co2-data.csv`;

/** Entities shown on first load (names as stored in the dataset). */
export const DEFAULT_COUNTRIES: readonly string[] = ['Germany'];

/** Requested 1950–2025; the dataset ends at 2024, so the max is clamped on load. */
export const DEFAULT_YEAR_RANGE: readonly [number, number] = [1950, 2025];

/** Default single-year selection for the "Global emissions" Sankey view. */
export const DEFAULT_GLOBAL_YEAR = 2020;

/** Number of top-emitting countries shown individually per continent in the Sankey. */
export const SANKEY_TOP_COUNTRIES = 3;

/** Metric extension point: add entries here to expose new measures (OCP). */
export const METRICS: Record<MetricKey, MetricDefinition> = {
  co2: {
    key: 'co2',
    column: 'co2',
    label: 'Annual CO₂ emissions',
    unit: 'million tonnes',
  },
  co2_including_luc: {
    key: 'co2_including_luc',
    column: 'co2_including_luc',
    label: 'Annual CO₂ (incl. LUC)',
    unit: 'million tonnes',
  },
};

export const DEFAULT_METRIC: MetricDefinition = METRICS.co2_including_luc;

/** Auxiliary columns retained for lens effects (read directly, never recomputed). */
export const EXTRA_COLUMNS: readonly string[] = [
  'co2_per_capita',
  'co2_growth_abs',
  'co2_growth_prct',
  'coal_co2',
  'oil_co2',
  'gas_co2',
  'cement_co2',
  'flaring_co2',
  'other_industry_co2',
  'land_use_change_co2',
];

/** CO₂ source breakdown used by the focused-continent source lens. */
export const CO2_SOURCES = [
  {
    key: 'coal_co2',
    label: 'Coal',
    description: 'CO₂ from burning coal for electricity generation, heating, and industrial processes.',
    color: '#6b4c3b',
  },
  {
    key: 'oil_co2',
    label: 'Oil',
    description: 'CO₂ from burning oil products — primarily transport, but also heating and industry.',
    color: '#c8813e',
  },
  {
    key: 'gas_co2',
    label: 'Gas',
    description: 'CO₂ from burning natural gas in power plants, buildings, and industry.',
    color: '#f5c261',
  },
  {
    key: 'cement_co2',
    label: 'Cement',
    description: 'CO₂ released during cement production when limestone is heated (calcination).',
    color: '#9e9e9e',
  },
  {
    key: 'flaring_co2',
    label: 'Flaring',
    description: 'CO₂ from burning off excess natural gas at oil and gas extraction sites.',
    color: '#e05c5c',
  },
  {
    key: 'other_industry_co2',
    label: 'Other industry',
    description: 'CO₂ from other industrial processes not captured by the sources above.',
    color: '#7f9ecc',
  },
  {
    key: 'land_use_change_co2',
    label: 'Land use change',
    description: 'CO₂ from deforestation and land conversion. Positive when forests are cleared; negative when forests grow back.',
    color: '#4caf7d',
  },
] as const;

/** Lens window width bounds and default, in years. */
export const LENS_WIDTH = { min: 3, max: 40, default: 10 };

export const DEFAULT_LENS_EFFECT: LensEffectKey = 'growth-abs';

// Single source of truth for lens stage colors — sidebar panel and slope lines both read from here (LENS-02).
export const STAGE_COLORS: Record<1 | 2 | 3, string> = {
  1: '#2e9e5b',
  2: '#e08a2e',
  3: '#3b73c8',
} as const;

// Phase-4 name for lens year-span bounds; mirrors LENS_WIDTH values so behaviour is unchanged until Plan 05 removes LENS_WIDTH.
export const LENS_STAGE_WIDTH = { min: 3, max: 40, default: 10 } as const;
