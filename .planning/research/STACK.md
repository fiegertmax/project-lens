# Stack Research: v1.3 GDP Lens — Scatterplot Panel and Dual-Metric Slope Chart

**Project:** ProjectLens
**Scope:** Adding a GDP-contextualised scatterplot panel and dual-metric slope chart to the existing D3.js v7 + TypeScript + Vite app
**Researched:** 2026-06-20
**Confidence:** HIGH — all patterns use D3 v7 stable APIs already installed; no new dependencies are required

---

## Summary

Zero new npm dependencies. The scatterplot panel and dual-metric slope chart require only D3 v7 functions already bundled with the installed `d3@7.9.0` package. The scatterplot uses `scaleLinear` (already imported in three chart files), `axisLeft`/`axisBottom` (already used by `CombinedChart` and `SingleCountryChart`), and `circle` SVG elements appended via D3's standard `selectAll/join` pattern. The dual-metric slope chart reuses the existing `SlopeChart` class structure: two independent `scaleLinear` y-scales (one per metric), each driving its own parallel axis and set of endpoint dots.

The only data additions needed are two new `EXTRA_COLUMNS` entries (`gdp` and `population`) so `EmissionsDataset.load()` carries them in `RawPoint.extra`, enabling in-browser derivation of `gdp / population`. GDP per capita coverage in the CSV is 165 countries from 1950–2022, giving adequate data for the lens window interaction.

---

## 1. Data Layer — GDP Per Capita Derived In-Browser

### Confirmed CSV columns (via `head -1 owid-co2-data.csv`)

| Column | Present | Unit | Notes |
|--------|---------|------|-------|
| `gdp` | yes | USD 2011 international PPP | nominal value, ~3.7T for Germany 2020 |
| `population` | yes | persons | Germany: ~83M for 2020 |
| `co2_including_luc_per_capita` | yes | tonnes CO₂/person | already in EXTRA_COLUMNS |

OWID does not supply a pre-computed `gdp_per_capita` column (in the sense used here). The closest existing column is `co2_per_gdp`, which is the inverse of what is needed. Derive `gdp / population` in-browser. For Germany the result is ~$44,754 in 2020, which is plausible.

**Coverage:** 15,220 rows have both `gdp` and `population` non-empty — 165 countries, each with up to 73 post-1950 data points. Rows where either is empty produce `NaN`; the scatterplot must filter them out before binding to circle elements.

### EXTRA_COLUMNS extension (config.ts)

Add two columns. Both are already in the CSV header; they just need to be retained during dataset indexing:

```typescript
export const EXTRA_COLUMNS: readonly string[] = [
  'co2',
  'co2_per_capita',
  'co2_including_luc_per_capita',
  'co2_growth_abs',
  'co2_growth_prct',
  'coal_co2',
  'oil_co2',
  'gas_co2',
  'cement_co2',
  'flaring_co2',
  'other_industry_co2',
  'land_use_change_co2',
  'gdp',          // ADD — raw GDP in USD PPP, needed for gdp/population division
  'population',   // ADD — needed to derive gdp per capita
];
```

`EmissionsDataset` already calls `parseExtra(row, extraColumns)` which stores every listed column in `RawPoint.extra[column]`. No changes to `EmissionsDataset` itself.

### GDP per capita computation

A pure utility function, one line of math:

```typescript
// utils/resolveGdpPerCapita.ts
export function gdpPerCapita(point: RawPoint): number {
  const gdp = point.extra['gdp'];
  const pop = point.extra['population'];
  return Number.isFinite(gdp) && Number.isFinite(pop) && pop > 0
    ? gdp / pop
    : NaN;
}
```

`NaN` propagates through D3 scales and is filtered by the `Number.isFinite` guard before rendering. This follows the same pattern as `getSourceValue` and `resolveColumn` — a single-purpose utility in `src/utils/`.

---

## 2. Scatterplot Panel — D3 Patterns Required

### What is being rendered

For the combined multi-country per-capita + lens view: every (country, year) point that falls within the active lens window, where both `co2_including_luc_per_capita` and `gdp/population` are finite. Points are colored by lens stage (green/orange/blue from `STAGE_COLORS`). Each additional active lens adds dots in its stage color.

### D3 functions needed

All of these are already imported somewhere in the codebase. No new D3 sub-module references are required.

| D3 function | Already imported in | Purpose |
|-------------|---------------------|---------|
| `scaleLinear` | `SingleCountryChart`, `SlopeChart`, `CombinedChart` | x and y scales |
| `axisBottom` | `SingleCountryChart`, `CombinedChart` | x-axis (GDP per capita) |
| `axisLeft` | `SingleCountryChart`, `CombinedChart` | y-axis (CO₂ per capita) |
| `format` | `SlopeChart`, `CrosshairOverlay`, `metricSpec` | tick formatters |
| `select` | nearly every chart file | SVG group management |
| `Selection` type | `SlopeChart`, `SingleCountryChart` | TypeScript typing |

### Scatter circle join pattern

The standard D3 v7 scatterplot pattern using `selectAll/join` on `circle` elements:

```typescript
const dots: { x: number; y: number; stage: LensStage; id: string }[] = /* computed */;

g.selectAll<SVGCircleElement, typeof dots[number]>('circle.scatter-dot')
  .data(dots, (d) => d.id)
  .join(
    (enter) => enter.append('circle').attr('class', 'scatter-dot').attr('r', 3),
    (update) => update,
    (exit) => exit.remove(),
  )
  .attr('cx', (d) => xScale(d.x))
  .attr('cy', (d) => yScale(d.y))
  .attr('fill', (d) => STAGE_COLORS[d.stage])
  .attr('opacity', 0.65);
```

The `id` key (`${country}-${year}-${stage}`) prevents D3 from re-creating circles on re-render when only the lens window shifts. The `.join` three-function form matches the pattern already used in `SingleCountryChart.renderLine`.

### Axis handling for two independent metrics in one panel

Both axes use `scaleLinear` with independent domains — there is no shared scale or dual-axis complexity:

- **x-axis:** GDP per capita domain `[xMin, xMax]` derived from the visible dot set, with `.nice()` padding. Typical range: $5,000–$120,000. Use `format('~s')` for SI prefix ticks (e.g., `50k`).
- **y-axis:** CO₂ per capita domain `[0, yMax]` derived from the visible dot set. Typical range: 0–25 tonnes. Use `format('.1f')` for ticks.

Both domains must be recomputed on every lens update because the lens window changes which country-years are visible.

```typescript
const xScale = scaleLinear()
  .domain(extent(dots, (d) => d.x) as [number, number])
  .nice()
  .range([0, innerW]);

const yScale = scaleLinear()
  .domain([0, max(dots, (d) => d.y) ?? 1])
  .nice()
  .range([innerH, 0]);
```

`extent` and `max` from D3 are already imported via the umbrella `d3` package. They do not need to be added to any import statement if the import is `import { ..., extent, max } from 'd3'` — both are in d3-array, which is re-exported by the `d3` bundle.

### Panel placement

The scatterplot panel sits in the same position as the slope chart currently does for single-country charts — to the right of the line chart. For the combined multi-country chart, it appears beneath or beside the chart area. The exact layout is a UI/CSS decision, not a D3 API decision. The panel is implemented as a new class (`ScatterPanel`) following the same constructor signature as `SlopeChart`:

```typescript
export class ScatterPanel {
  constructor(parent: HTMLElement) { /* append svg, set up groups */ }
  render(lenses: StagedLensWindow[], dataset: EmissionsDataset, countries: string[]): void { /* ... */ }
  clear(): void { /* selectAll('*').remove() on each group */ }
  destroy(): void { this.root.remove(); }
}
```

This mirrors `SlopeChart`'s API exactly, so `SingleCountryChart` and `ChartArea` can manage it identically.

---

## 3. Dual-Metric Slope Chart — D3 Patterns Required

### What is being rendered

For the single-country per-capita + lens view: two lines per lens segment connecting the **lens boundary years** — one line for `gdp/population` (GDP per capita) and one for `co2_including_luc_per_capita`. The two metrics live on independent y-scales because their units and magnitudes are incomparable (tens of thousands of USD vs single-digit tonnes).

### Two-scale parallel coordinates pattern

The existing `SlopeChart` uses a single shared `y: ScaleLinear` for all source lines. The dual-metric chart needs two independent y-scales, each with its own axis. The pattern is established in D3 multi-axis charts:

```typescript
// Left axis: CO₂ per capita (tonnes)
const yCO2 = scaleLinear()
  .domain([0, max(values, (d) => d.co2PerCapita) ?? 1])
  .nice()
  .range([innerH, 0]);
this.group('y-axis-left').call(axisLeft(yCO2).ticks(5).tickFormat(format('.1f')));

// Right axis: GDP per capita (USD thousands)
const yGDP = scaleLinear()
  .domain([0, max(values, (d) => d.gdpPerCapita) ?? 1])
  .nice()
  .range([innerH, 0]);
this.group('y-axis-right')
  .attr('transform', `translate(${innerW}, 0)`)
  .call(axisRight(yGDP).ticks(5).tickFormat(format('~s')));
```

`axisRight` is already imported in `SlopeChart.ts`. `axisLeft` is imported in `SingleCountryChart` and `CombinedChart`. Both are present in the installed `d3` package.

Each metric line is then positioned using its own scale:

```typescript
// CO₂ per capita line (left scale)
g.append('line')
  .attr('class', 'gdp-slope__co2-line')
  .attr('x1', lx).attr('y1', yCO2(leftCO2))
  .attr('x2', rx).attr('y2', yCO2(rightCO2))
  .attr('stroke', '#4e79a7')  // or stage color
  .attr('stroke-width', 2);

// GDP per capita line (right scale)
g.append('line')
  .attr('class', 'gdp-slope__gdp-line')
  .attr('x1', lx).attr('y1', yGDP(leftGDP))
  .attr('x2', rx).attr('y2', yGDP(rightGDP))
  .attr('stroke', '#f28e2b')
  .attr('stroke-width', 2);
```

The two-scale approach avoids normalizing the metrics (which would lose interpretability) and avoids a secondary y-axis confusion that a single shared scale would create. Each line is labeled at the right-side axis so the reader knows which scale each line reads.

### Reuse vs new class decision

**Do not extend `SlopeChart`.** The dual-metric slope chart is structurally different:
- `SlopeChart` renders N emission sources × 1 shared scale. The dual-metric chart renders 2 metrics × 2 independent scales.
- `SlopeChart`'s internal `buildEntries` / `renderStageLines` / `renderAllLabels` methods are tightly coupled to `SourceEntry` and `EMISSION_SOURCES`.

Create a new class `GdpSlopeChart` with the same public API surface (`render`, `clear`, `destroy`, `node`) but separate internal rendering logic. This follows the open/closed principle already established by `SlopeChart` and keeps `SlopeChart` unchanged.

```typescript
export class GdpSlopeChart {
  constructor(parent: HTMLElement) { /* append svg */ }
  render(country: string, lenses: StagedLensWindow[], dataset: EmissionsDataset): void { /* ... */ }
  clear(): void { /* ... */ }
  destroy(): void { this.root.remove(); }
}
```

---

## 4. Mode-Aware Lens Effect Dispatch

### The branching point

`SingleCountryChart.renderSlope()` is the current dispatch site. Currently it short-circuits when `metricMode === 'per-capita'` (PROJECT.md: "no source-breakdown reveal"). For v1.3 that short-circuit changes to a dispatch:

```typescript
private renderGdpPanel(lenses: PlacedLens[]): void {
  // Calls GdpSlopeChart.render() for single-country
  // or ScatterPanel.render() for combined chart — determined by the calling context
}
```

`ChartArea` (for the combined chart) and `SingleCountryChart` (for single-country) each maintain their own instance of the appropriate panel class. `AppState.metricMode()` is already accessible at both sites, so the branch `if (metricMode === 'per-capita') → GDP panel else → SlopeChart` requires no new state.

### No changes to CountryLensState or LensSync

Both classes are metric-agnostic. Lens window state (`startYear`, `endYear`, `stage`) feeds both the existing slope chart and the new GDP panels without modification. The data column used to populate the new charts is determined by the rendering class, not stored in lens state.

---

## 5. Complete List of D3 Functions Used by New Features

This is the incremental addition on top of what is already imported across the codebase:

| Function | Sub-module | Already imported? | New import site |
|----------|-----------|-------------------|-----------------|
| `scaleLinear` | d3-scale | yes (CombinedChart, SingleCountryChart, SlopeChart) | ScatterPanel, GdpSlopeChart |
| `axisBottom` | d3-axis | yes (CombinedChart, SingleCountryChart) | ScatterPanel |
| `axisLeft` | d3-axis | yes (CombinedChart, SingleCountryChart) | ScatterPanel, GdpSlopeChart |
| `axisRight` | d3-axis | yes (SlopeChart) | GdpSlopeChart |
| `format` | d3-format | yes (SlopeChart, CrosshairOverlay, metricSpec) | ScatterPanel, GdpSlopeChart |
| `select` | d3-selection | yes (nearly all files) | ScatterPanel, GdpSlopeChart |
| `extent` | d3-array | in bundle, not yet destructured | ScatterPanel (domain computation) |
| `max` | d3-array | in bundle, not yet destructured | ScatterPanel, GdpSlopeChart |

`extent` and `max` are re-exported by the `d3` umbrella package and available without any new npm install. They are added to import statements, not to package.json.

---

## 6. What NOT to Add

| Thing | Why not |
|-------|---------|
| New npm dependency (e.g. Vega-Lite, Observable Plot) | Scatterplot with two linear axes is a core D3 v7 primitive; a new library adds bundle weight and style inconsistency |
| `d3-brush` for selection in the scatterplot | Not in scope for v1.3; lens window interaction is already handled by `LensBandRenderer` on the line chart |
| `d3-zoom` on the scatterplot | The scatterplot domain is bounded by the lens window; no pan/zoom interaction is required |
| `d3-force` or layout algorithms | Dots are positioned by data (gdp_pc, co2_pc) — no force simulation needed |
| Pre-computed `gdp_per_capita` column from OWID | No such column exists in the CSV; the raw `gdp` and `population` columns are what's available |
| Shared y-scale for the dual-metric slope | GDP (tens of thousands USD) and CO₂ per capita (0–25 tonnes) have incomparable magnitudes; a shared scale would make one metric unreadable |
| Extending `SlopeChart` for GDP rendering | The source structure (`EMISSION_SOURCES`, `buildEntries`, `SourceEntry`) is tightly coupled to emission-source rendering; extending it would force awkward overrides |
| `d3-scale-chromatic` for dot coloring | Stage colors already defined in `STAGE_COLORS` config; a chromatic scale would be inconsistent with the lens UI |
| `tooltip` library | `CrosshairOverlay` pattern already handles hover values; a new tooltip library adds inconsistency |
| In-memory caching of GDP per capita per (country, year) | The computation (`gdp / population`) is O(1) per point; caching is unnecessary overhead |

---

## 7. Integration with Existing Components

### ScatterPanel integration into ChartArea

`ChartArea` already manages `SlopeChart` instances per extracted single-country chart. For the combined-chart GDP panel:

1. `ChartArea` instantiates one `ScatterPanel` alongside the combined chart SVG.
2. On every lens update (subscribed via `LensSync` or `CountryLensState`), `ChartArea` calls `scatterPanel.render(lenses, dataset, selectedCountries)` when `metricMode === 'per-capita'`, or calls `scatterPanel.clear()` in absolute mode.
3. The panel's container div is toggled visible/hidden based on mode, using the same CSS class toggle pattern as the slope chart's `--lens-active` modifier.

### GdpSlopeChart integration into SingleCountryChart

`SingleCountryChart` already manages one `SlopeChart` via `this.slopeChart`. For the GDP variant:

1. Add `private readonly gdpSlopeChart: GdpSlopeChart` alongside `slopeChart`.
2. In `renderSlope()`, branch on `metricMode`:
   - `absolute` → `this.slopeChart.render(...)`, `this.gdpSlopeChart.clear()`
   - `per-capita` → `this.gdpSlopeChart.render(...)`, `this.slopeChart.clear()`
3. Both instances share the same `slopeCell` DOM container. `clear()` empties the SVG without removing the element, so the layout slot is preserved.

### No changes required to

- `EmissionsDataset` (beyond EXTRA_COLUMNS change in config.ts)
- `LensBandRenderer`
- `LensSync`
- `CountryLensState`
- `CrosshairOverlay`
- `resolveSeries` / `interpolation.ts`
- `AppState` (metricMode is already implemented and firing notifications)

---

## 8. Confidence Levels

| Area | Confidence | Notes |
|------|------------|-------|
| GDP and population CSV columns | HIGH | Confirmed via `head -1` — both present; Germany has data 1820–2022 |
| In-browser gdp/population division | HIGH | Simple arithmetic; NaN guard pattern already established by `getSourceValue` |
| D3 scatterplot (scaleLinear + circle join) | HIGH | Core D3 v7 primitive; pattern established in every chart class in the codebase |
| Two-scale parallel slope chart | HIGH | `axisLeft` + `axisRight` + two independent `scaleLinear` calls — all already used in the codebase |
| Zero new npm dependencies | HIGH | Every required function is re-exported by the installed `d3@7.9.0` bundle |
| `extent` and `max` from d3-array | HIGH | Available in bundle; standard D3 v7 domain helpers |
| GDP data coverage (30% of rows) | MEDIUM | 165 countries have data, but many historical/small-country rows will produce NaN dots that must be filtered; visual density depends on which countries are selected |
