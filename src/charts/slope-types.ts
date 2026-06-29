import { CO2_SOURCES } from '../config';

/** A lens is represented as a closed [startYear, endYear] interval. */
export interface LensWindow {
  startYear: number;
  endYear: number;
}

/**
 * Pre-computed per-source values for the combined-chart slope panel.
 * Values cannot be looked up from a single country; the aggregator pre-computes
 * the cross-country sum for each source at each boundary year (CMEAN-02..04).
 */
export interface AggregatedLensWindow extends LensWindow {
  values: Map<string, { left: number | undefined; right: number | undefined }>;
}

/**
 * Derives the ordered column positions for a slope chart from N lens windows.
 * Each lens contributes its startYear and endYear; shared boundaries are kept
 * duplicated so consecutive lens segments meet at the same column (SLOPE-05).
 */
export function boundaryYears(lenses: LensWindow[]): number[] {
  return lenses.flatMap((l) => [l.startYear, l.endYear]).sort((a, b) => a - b);
}

/** All emission source definitions, single-sourced from config (SLOPE-04). */
export const EMISSION_SOURCES: ReadonlyArray<{ key: string; label: string; description: string; color: string }> =
  CO2_SOURCES.map(({ key, label, description, color }) => ({ key, label, description, color }));
