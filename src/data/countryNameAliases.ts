/** Maps Natural Earth country names (world-atlas) to OWID dataset names.
 *  Only the handful that genuinely differ need an entry; everything else
 *  matches verbatim. Names without an OWID series are simply unavailable. */
const NE_TO_OWID: Record<string, string> = {
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Central African Rep.': 'Central African Republic',
  'Côte d\'Ivoire': 'Cote d\'Ivoire',
  'Dem. Rep. Congo': 'Democratic Republic of Congo',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'Macedonia': 'North Macedonia',
  'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands',
  'Timor-Leste': 'East Timor',
  'United States of America': 'United States',
  'eSwatini': 'Eswatini',
};

/** Resolve a Natural Earth feature name to its OWID dataset equivalent. */
export function resolveOwidName(neName: string): string {
  return NE_TO_OWID[neName] ?? neName;
}
