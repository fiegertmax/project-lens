import { COUNTRY_TO_CONTINENT } from '../data/continents';
import type { EmissionsDataset } from '../data/EmissionsDataset';

/** Links/nodes below this value (million tonnes) are dropped as visual noise. */
export const EPSILON = 0.05;

export interface NodeDatum {
  name: string;
  color: string;
}

export interface RawLink {
  source: number;
  target: number;
  value: number;
}

/** Mutable accumulator while walking a Sankey hierarchy top-down. */
export interface GraphBuilder {
  nodes: NodeDatum[];
  links: RawLink[];
  indexOf: Map<string, number>;
}

export function createGraphBuilder(): GraphBuilder {
  return { nodes: [], links: [], indexOf: new Map() };
}

export function addNode(builder: GraphBuilder, name: string, color: string): number {
  const existing = builder.indexOf.get(name);
  if (existing !== undefined) return existing;
  const index = builder.nodes.length;
  builder.nodes.push({ name, color });
  builder.indexOf.set(name, index);
  return index;
}

/** All countries of a continent with data this year, sorted by descending emissions. */
export function countriesOfContinent(
  dataset: EmissionsDataset,
  continent: string,
  year: number,
): { country: string; value: number }[] {
  return Object.entries(COUNTRY_TO_CONTINENT)
    .filter(([, c]) => c === continent)
    .map(([country]) => ({ country, value: dataset.valueInYear(country, year) }))
    .filter((c): c is { country: string; value: number } => c.value !== undefined && c.value > EPSILON)
    .sort((a, b) => b.value - a.value);
}

/** <root> -> one leaf per source entry, each with its own color.
 *  Used by the source-breakdown lens in focused-continent mode. */
export function buildSourceGraph(
  rootName: string,
  rootColor: string,
  sources: { label: string; value: number; color: string }[],
): GraphBuilder {
  const builder = createGraphBuilder();
  if (sources.length === 0) return builder;
  const rootIndex = addNode(builder, rootName, rootColor);
  for (const { label, value, color } of sources) {
    const idx = addNode(builder, label, color);
    builder.links.push({ source: rootIndex, target: idx, value });
  }
  return builder;
}

/** <root> -> one leaf per entry in `countries` (no "Other", no top-N limiting).
 *  Used for both the focused-continent zoom and the "Other <continent>" lens. */
export function buildRootGraph(
  rootName: string,
  rootColor: string,
  countries: { country: string; value: number }[],
): GraphBuilder {
  const builder = createGraphBuilder();
  if (countries.length === 0) return builder;

  const rootIndex = addNode(builder, rootName, rootColor);
  for (const { country, value } of countries) {
    const index = addNode(builder, country, rootColor);
    builder.links.push({ source: rootIndex, target: index, value });
  }
  return builder;
}
