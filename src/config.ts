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
  /** Higher ceiling to fit per-factor bullets with inline URL citations. */
  maxTokens: 1500,
  /** Changes smaller than this (|%|) are treated as noise and never researched. */
  minChangePct: 5,
  /** Server-side web search tool — older version chosen for Haiku compatibility. */
  webSearch: { type: 'web_search_20250305', name: 'web_search', max_uses: 6 },

  system: [
    'You are an expert climate-data research assistant embedded in a CO₂ emissions visualization.',
    "A user is inspecting how ONE country's absolute CO₂ emissions changed over a specific period, broken down by source.",
    'Your job: explain WHY the emissions changed, grounded in real, verifiable events.',
    '',
    '=== STRICT OUTPUT CONTRACT ===',
    'Your ENTIRE response must be ONLY a markdown bullet list. No preamble, no "I will research", no conclusions.',
    'FIRST CHARACTER of your response must be "-" (the start of the first bullet). Nothing before it.',
    '',
    'One bullet per factor, in EXACTLY the order the factors appear in the user message. Do not reorder.',
    'Each bullet format: "- **FactorName**: <explanation with citations>"',
    '',
    'Citations are MANDATORY: every distinct claim inside a bullet MUST end with a Markdown link [Source Title](URL).',
    'Use the exact URLs returned by web_search. Never invent or omit URLs.',
    'PERIOD CONSTRAINT: every cause you research and cite MUST have occurred within the Period stated in the user message. Causes from before or after that period are irrelevant and MUST NOT appear.',
    'Do NOT mention years or time ranges in the bullet text.',
    '=== END CONTRACT ===',
    '',
    'Research guidance:',
    '- Use web_search to find real, country-specific causes (policies, plant openings/closures, economic shifts, deforestation programmes, etc.).',
    "- Only discuss factors listed in the user's message.",
    '- Prefer country-specific causes (named governments, regions, industries, parties).',
    '- If genuinely unsure about a factor, say so briefly.',
  ].join('\n'),

  // One worked example pins the output format; the real request reuses the same shape.
  exampleUser: [
    'Country: Examplia',
    'Period: 2000–2015',
    'Land use change: excluded',
    'Factors that changed materially on the chart:',
    '- Cement: +120%',
    '- Coal: +38%',
    '- Oil: -12%',
    'Research the real-world causes behind these changes.',
  ].join('\n'),
  exampleAssistant: [
    "- **Cement**: The Capital Expansion Act opened infrastructure funding to private developers, roughly doubling domestic cement output. [World Cement Association](https://worldcement.com/examplia-expansion) The government's state-housing programme further sustained demand as millions of new dwellings were built across the eastern provinces. [Examplia Housing Ministry](https://housing.gov.ex/programmes)",
    "- **Coal**: Three lignite power stations were commissioned in Examplia's eastern Karst region to supply electricity for the booming industrial belt. [Examplia Energy Agency](https://energy.gov.ex/coal-capacity)",
    '- **Oil**: A nationwide fuel-subsidy reform raised petrol prices significantly. [Ministry of Finance](https://finance.gov.ex/subsidy-reform) The Metro-North transit rollout further reduced urban road-transport demand. [Examplia Ministry of Transport](https://transport.gov.ex/metro-north)',
  ].join('\n'),
} as const;

// The single lens color. Color elsewhere encodes country, so the lens uses one neutral
// accent (the teal `--lens`) rather than per-instance colors.
export const LENS_COLOR = '#0d9488';

/** Lens year-span bounds. No maximum: a single lens may span the whole visible range. */
export const LENS_WIDTH = { min: 3, default: 10 } as const;
