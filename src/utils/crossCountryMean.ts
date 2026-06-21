import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AggregatedLensWindow, StagedLensWindow } from '../charts/slope-types';
import { EMISSION_SOURCES } from '../charts/slope-types';
import { getSourceValue } from './getSourceValue';

export type MeanMode = 'simple' | 'weighted';

/**
 * Sums each country's emissions over the selected year range to produce a scalar
 * weight per country. Uses co2_including_luc (point.value) when LUC is included,
 * or the fossil-only 'co2' extra column when excluded.
 * Weights are computed once per crossCountryMean call, not per lens (CMEAN-03).
 */
function computeWeights(
  countries: string[],
  dataset: EmissionsDataset,
  yearRange: [number, number],
  includeLUC: boolean,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const country of countries) {
    const points = dataset.series(country)?.points ?? [];
    let total = 0;
    for (const p of points) {
      if (p.year >= yearRange[0] && p.year <= yearRange[1]) {
        const v = includeLUC ? p.value : p.extra['co2'];
        if (Number.isFinite(v)) total += v;
      }
    }
    weights.set(country, total);
  }
  return weights;
}

/**
 * Computes the mean source value across countries for one (sourceKey, year) cell.
 * Countries missing a finite value for this source/year are excluded from both
 * numerator and denominator — they must not be coerced to zero (CMEAN-04).
 * weights === null selects simple mean; non-null selects weighted mean (CMEAN-03).
 * Returns undefined for land_use_change_co2 when includeLUC is false.
 */
function meanForSourceYear(
  countries: string[],
  sourceKey: string,
  year: number,
  dataset: EmissionsDataset,
  weights: Map<string, number> | null,
  includeLUC: boolean,
): number | undefined {
  if (!includeLUC && sourceKey === 'land_use_change_co2') return undefined;
  if (weights === null) {
    // Simple mean: sum valid values and divide by the count of valid contributors.
    let sum = 0;
    let count = 0;
    for (const country of countries) {
      const val = getSourceValue(dataset, country, sourceKey, year);
      if (val === undefined) continue;
      sum += val;
      count++;
    }
    return count > 0 ? sum / count : undefined;
  } else {
    // Weighted mean: weight = co2_including_luc total over yearRange.
    // Skip countries with missing source value OR weight <= 0 (CMEAN-03).
    let weightedSum = 0;
    let totalWeight = 0;
    for (const country of countries) {
      const val = getSourceValue(dataset, country, sourceKey, year);
      if (val === undefined) continue;
      const w = weights.get(country) ?? 0;
      if (w <= 0) continue;
      weightedSum += val * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : undefined;
  }
}

/**
 * Sums source values across all countries for one (sourceKey, year) cell.
 * Countries missing a finite value are treated as zero so the total is not understated.
 * Returns undefined for land_use_change_co2 when includeLUC is false.
 */
function sumForSourceYear(
  countries: string[],
  sourceKey: string,
  year: number,
  dataset: EmissionsDataset,
  includeLUC: boolean,
): number | undefined {
  if (!includeLUC && sourceKey === 'land_use_change_co2') return undefined;
  let sum = 0;
  let hasAny = false;
  for (const country of countries) {
    const val = getSourceValue(dataset, country, sourceKey, year);
    if (val === undefined) continue;
    sum += val;
    hasAny = true;
  }
  return hasAny ? sum : undefined;
}

/**
 * Aggregates per-country source values into cross-country sums for each lens boundary year.
 * Use this for absolute (total) emissions mode where summing across countries is meaningful.
 */
export function crossCountrySum(
  countries: string[],
  lenses: StagedLensWindow[],
  dataset: EmissionsDataset,
  includeLUC = true,
): AggregatedLensWindow[] {
  return lenses.map((lens) => {
    const values = new Map<string, { left: number | undefined; right: number | undefined }>();
    for (const src of EMISSION_SOURCES) {
      values.set(src.key, {
        left: sumForSourceYear(countries, src.key, lens.startYear, dataset, includeLUC),
        right: sumForSourceYear(countries, src.key, lens.endYear, dataset, includeLUC),
      });
    }
    return { ...lens, values };
  });
}

/**
 * Aggregates per-country source values into cross-country means for each lens boundary year.
 * Returns one AggregatedLensWindow per input lens, preserving stage/startYear/endYear and
 * adding a values Map keyed by every EMISSION_SOURCES entry.
 */
export function crossCountryMean(
  countries: string[],
  lenses: StagedLensWindow[],
  dataset: EmissionsDataset,
  yearRange: [number, number],
  mode: MeanMode,
  includeLUC = true,
): AggregatedLensWindow[] {
  const weights = mode === 'weighted' ? computeWeights(countries, dataset, yearRange, includeLUC) : null;

  return lenses.map((lens) => {
    const values = new Map<string, { left: number | undefined; right: number | undefined }>();
    for (const src of EMISSION_SOURCES) {
      values.set(src.key, {
        left: meanForSourceYear(countries, src.key, lens.startYear, dataset, weights, includeLUC),
        right: meanForSourceYear(countries, src.key, lens.endYear, dataset, weights, includeLUC),
      });
    }
    return { ...lens, values };
  });
}
