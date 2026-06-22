import { AI_RESEARCH } from '../config';
import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { PlacedLens } from '../state/CountryLensState';
import { EMISSION_SOURCES } from '../charts/slope-types';
import { getSourceValue } from '../utils/getSourceValue';

/** A single-country slope chart the user selected for AI research. */
export interface TrendTarget {
  country: string;
  lenses: PlacedLens[];
  includeLUC: boolean;
}

/** One emission source's change across the researched span. */
export interface FactorChange {
  label: string;
  startValue: number;
  endValue: number;
  pctChange: number;
}

/** Everything the prompt needs about the selected trend. */
export interface TrendContext {
  country: string;
  startYear: number;
  endYear: number;
  includeLUC: boolean;
  factors: FactorChange[];
}

/**
 * Reduces a selected slope chart to the factors actually worth researching:
 * only sources with data at both ends of the displayed span whose change clears
 * the minimum threshold. Land use change is dropped when the LUC toggle is off,
 * mirroring exactly what the chart shows.
 */
export function buildTrendContext(dataset: EmissionsDataset, target: TrendTarget): TrendContext {
  const startYear = Math.min(...target.lenses.map((l) => l.startYear));
  const endYear = Math.max(...target.lenses.map((l) => l.endYear));

  const factors: FactorChange[] = [];
  for (const src of EMISSION_SOURCES) {
    if (!target.includeLUC && src.key === 'land_use_change_co2') continue;

    const start = getSourceValue(dataset, target.country, src.key, startYear);
    const end = getSourceValue(dataset, target.country, src.key, endYear);
    if (start === undefined || end === undefined || start === 0) continue;

    const pctChange = ((end - start) / Math.abs(start)) * 100;
    if (Math.abs(pctChange) < AI_RESEARCH.minChangePct) continue;

    factors.push({ label: src.label, startValue: start, endValue: end, pctChange });
  }

  // Largest movers first so the model leads with the most consequential causes.
  factors.sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));

  return { country: target.country, startYear, endYear, includeLUC: target.includeLUC, factors };
}
