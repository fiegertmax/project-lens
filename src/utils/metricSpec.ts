import { format } from 'd3';
import type { MetricMode } from '../state/AppState';
import { resolveColumn } from './resolveColumn';

// Single source of truth for per-metric display strings across both chart classes —
// confirms STATE.md Phase 8 unit-format decision: per-capita '.2~f', absolute ',.2f'.

export interface MetricSpec {
  label: string;
  unit: string;
  valueLabel: (v: number) => string;
}

const ABS_FMT = format(',.2f');
const PERCAP_FMT = format('.2~f');

/** Returns the axis label, unit, and crosshair formatter for the active metric. */
export function metricSpec(metricMode: MetricMode, includeLUC: boolean): MetricSpec {
  const perCapita = metricMode === 'per-capita';
  const base = perCapita ? 'Annual CO₂ per capita' : 'Annual CO₂';
  const suffix = includeLUC ? ' (incl. LUC)' : ' (excl. LUC)';
  const label = base + suffix;
  const unit = perCapita ? 't CO₂/person' : 'million tonnes';
  const valueLabel = perCapita
    ? (v: number) => `${PERCAP_FMT(v)} t/person`
    : (v: number) => `${ABS_FMT(v)} Mt`;
  return { label, unit, valueLabel };
}

/**
 * Returns the extraColumn argument for resolveSeries() based on the active metric.
 * Returns undefined when resolveColumn resolves to 'co2_including_luc' (the primary
 * point.value column), otherwise returns the resolved column name.
 */
export function extraColumnFor(metricMode: MetricMode, includeLUC: boolean): string | undefined {
  const col = resolveColumn(metricMode, includeLUC);
  return col === 'co2_including_luc' ? undefined : col;
}
