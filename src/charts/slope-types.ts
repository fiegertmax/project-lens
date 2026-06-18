import { CO2_SOURCES } from '../config';

/** Phase-3 stub: a lens is represented as a closed [startYear, endYear] interval. */
export interface LensWindow {
  startYear: number;
  endYear: number;
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
export const EMISSION_SOURCES: ReadonlyArray<{ key: string; label: string; color: string }> =
  CO2_SOURCES.map(({ key, label, color }) => ({ key, label, color }));
