import { CO2_SOURCES } from '../config';

/** A lens is represented as a closed [startYear, endYear] interval. */
export interface LensWindow {
  startYear: number;
  endYear: number;
}

/** All emission source definitions, single-sourced from config (SLOPE-04). */
export const EMISSION_SOURCES: ReadonlyArray<{ key: string; label: string; description: string; color: string }> =
  CO2_SOURCES.map(({ key, label, description, color }) => ({ key, label, description, color }));
