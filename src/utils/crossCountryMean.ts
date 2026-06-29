import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AggregatedLensWindow, LensWindow } from '../charts/slope-types';
import { EMISSION_SOURCES } from '../charts/slope-types';
import { getSourceValue } from './getSourceValue';

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
  lenses: LensWindow[],
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

