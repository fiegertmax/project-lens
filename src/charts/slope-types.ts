import type { LensStage } from '../state/CountryLensState';
import { CO2_SOURCES } from '../config';

/** Phase-3 stub: a lens is represented as a closed [startYear, endYear] interval. */
export interface LensWindow {
  startYear: number;
  endYear: number;
}

/** Extends LensWindow with stage metadata for per-stage slope coloring (LENS-05). */
export interface StagedLensWindow extends LensWindow {
  stage: LensStage;
}

/**
 * Pre-computed per-source mean values for the combined-chart slope panel.
 * Values cannot be looked up from a single country; the aggregator pre-computes
 * the cross-country mean for each source at each boundary year (CMEAN-02..04).
 */
export interface AggregatedLensWindow extends StagedLensWindow {
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
