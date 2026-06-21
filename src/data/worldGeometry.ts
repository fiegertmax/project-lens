import { json } from 'd3';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { Feature, Geometry } from 'geojson';
import countriesTopoUrl from 'world-atlas/countries-110m.json?url';

/** A country polygon with its Natural Earth display name. */
export type CountryFeature = Feature<Geometry, { name: string }>;

let cache: CountryFeature[] | undefined;

/** Load and memoize the world country polygons (lazy: fetched on first use). */
export async function loadCountryFeatures(): Promise<CountryFeature[]> {
  if (cache) return cache;
  const topo = (await json(countriesTopoUrl)) as Topology;
  const collection = feature(topo, topo.objects.countries) as unknown as {
    features: CountryFeature[];
  };
  cache = collection.features;
  return cache;
}
