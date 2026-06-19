import type { MetricMode } from '../state/AppState';

// Single source of truth for the active CSV column name — both CombinedChart and
// SingleCountryChart call this in Phase 8 instead of branching on mode themselves.
export function resolveColumn(metricMode: MetricMode, includeLUC: boolean): string {
  const base = metricMode === 'per-capita' ? 'co2_per_capita' : 'co2';
  const lucVariant = metricMode === 'per-capita' ? 'co2_including_luc_per_capita' : 'co2_including_luc';
  return includeLUC ? lucVariant : base;
}
