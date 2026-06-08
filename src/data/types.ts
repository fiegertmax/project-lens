/** A single year's observation for one entity. value is NaN when missing. */
export interface RawPoint {
  year: number;
  value: number;
}

/** A point ready for rendering. isMissing marks interpolated (gap-filled) years. */
export interface DataPoint {
  year: number;
  value: number;
  isMissing: boolean;
}

/** All raw observations for one country/entity, sorted ascending by year. */
export interface CountrySeries {
  country: string;
  points: RawPoint[];
}

/** Extracts a comparable numeric metric from a raw CSV cell value. */
export type MetricKey = 'co2';

export interface MetricDefinition {
  key: MetricKey;
  /** CSV column the metric reads from. */
  column: string;
  label: string;
  unit: string;
}
