import type { MetricDefinition, MetricKey } from './data/types';

/** Runtime URL of the dataset, served from public/. */
export const DATA_URL = `${import.meta.env.BASE_URL}data/owid-co2-data.csv`;

/** Entities shown on first load (names as stored in the dataset). */
export const DEFAULT_COUNTRIES: readonly string[] = ['Germany'];

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
  'co2',
  'co2_including_luc',
  'co2_per_capita',
  'co2_including_luc_per_capita',
  'gdp',
  'population',
  'co2_growth_abs',
  'co2_growth_prct',
  // Absolute per-source breakdown (single-country driving factors, absolute mode)
  'coal_co2',
  'oil_co2',
  'gas_co2',
  'cement_co2',
  'flaring_co2',
  'other_industry_co2',
  'land_use_change_co2',
  // Per-capita per-source breakdown (driving factors, per-capita mode). No
  // other_industry_co2_per_capita exists in OWID, so that source is absent there.
  'coal_co2_per_capita',
  'oil_co2_per_capita',
  'gas_co2_per_capita',
  'cement_co2_per_capita',
  'flaring_co2_per_capita',
  'land_use_change_co2_per_capita',
];

/** CO₂ source breakdown used by the per-source slope chart. */
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

/**
 * AI trend research config ("AI research" panel, available in both metric modes).
 * The prompt lives here as a dynamic few-shot template: a fixed system prompt plus one
 * worked example, with the per-country factor list injected at call time (see researchPrompt.ts).
 * Haiku is mandated for all web research per the feature spec.
 */
export const AI_RESEARCH = {
  /** Web research must run on Haiku. */
  model: 'claude-haiku-4-5',
  /** Keeps the answer short (a handful of bullets). */
  maxTokens: 900,
  /** Changes smaller than this (|%|) are treated as noise and never researched. */
  minChangePct: 5,
  /** Server-side web search tool — older version chosen for Haiku compatibility. */
  webSearch: { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },

  system: [
    'You are an expert climate-data research assistant embedded in a CO₂ emissions visualization.',
    "A user is inspecting how ONE country's absolute CO₂ emissions changed over a specific period, broken down by source.",
    'Your job: explain WHY the emissions changed, grounded in real, verifiable events.',
    '',
    'Rules:',
    '- Use web search to find real, country-specific causes (policies, power-plant openings/closures, economic shifts, wars, deforestation programs, political changes, etc.).',
    "- Only discuss the emission factors listed in the user's message. Never introduce factors that are not on display.",
    '- Tie each point to a concrete year or short year range inside the period.',
    '- Prefer country-specific causes (named governments, regions, industries, rainforests, parties).',
    '- Ignore minor fluctuations: only explain changes of roughly 5% or more.',
    '- Keep it short: 3–6 concise bullet points, one cause each. No intro or closing paragraph.',
    '- Each bullet ≤ 2 sentences and starts with the relevant year(s) in brackets, e.g. "[2011–2013]".',
    '- If you are genuinely unsure, say so briefly rather than inventing specifics.',
  ].join('\n'),

  // One worked example pins the output format; the real request reuses the same shape.
  exampleUser: [
    'Country: Examplia',
    'Period: 2000–2015',
    'Land use change: excluded',
    'Factors that changed materially on the chart:',
    '- Coal: +38%',
    '- Oil: -12%',
    '- Cement: +120%',
    'Research the real-world causes behind these changes.',
  ].join('\n'),
  exampleAssistant: [
    "- [2001–2007] Examplia's coal use climbed as three new lignite power stations in the eastern Karst region came online to meet booming industrial demand.",
    '- [2004 onward] A nationwide construction boom under the Capital Expansion Act roughly doubled cement output, the dominant driver of the cement-CO₂ rise.',
    '- [2009–2012] Oil emissions fell after fuel-subsidy reform and the Metro-North transit rollout cut urban road-transport demand.',
  ].join('\n'),
} as const;

// The single lens color. Color elsewhere encodes country, so the lens uses one neutral
// accent (the teal `--lens`) rather than per-instance colors.
export const LENS_COLOR = '#0d9488';

/** Lens year-span bounds. No maximum: a single lens may span the whole visible range. */
export const LENS_WIDTH = { min: 3, default: 10 } as const;
