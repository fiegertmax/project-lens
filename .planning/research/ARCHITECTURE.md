# Architecture Patterns: GDP Lens Integration

**Domain:** D3.js + TypeScript interactive visualization — magic-lens overlay system
**Researched:** 2026-06-20
**Milestone:** v1.3 GDP Lens
**Confidence:** HIGH (full codebase read; all integration points confirmed from source)

---

## Answers to the Four Integration Questions

### Q1 — Where does mode-aware dispatch live?

**Answer: inside the existing `renderLenses()` private methods of `CombinedChart` and `SingleCountryChart`. No new AppState subscriber is needed.**

Both chart classes already contain a `renderLenses()` method that fires on every `CountryLensState` notification. `CombinedChart.renderLenses()` (lines 438–449) already contains a `metricMode` guard that suppresses slope rendering in per-capita mode:

```typescript
// CombinedChart.renderLenses() — existing guard
const perCapita = this.state.metricMode() === 'per-capita';
if (active && !perCapita) {
  requestAnimationFrame(() => this.renderSlope(lenses));
} else {
  this.slopeChart.clear();
}
```

The v1.3 change replaces the else branch with the new GDP path:

```typescript
if (active && !perCapita) {
  requestAnimationFrame(() => this.renderSlope(lenses));        // existing absolute path
} else if (active && perCapita) {
  requestAnimationFrame(() => this.renderGdpView(lenses));      // new per-capita path
} else {
  this.slopeChart.clear();
  this.gdpScatterPanel.clear();
}
```

`renderGdpView()` is a new private method on `CombinedChart` (parallel to the existing `renderSlope()`).

**Why not a new AppState subscriber?**
`CombinedChart` already subscribes to `AppState` via `state.subscribe(() => this.update())`. `update()` calls `renderLensBands()`, whose `onChange` callback calls `renderLenses()`. When MetricMode changes, AppState notifies → `update()` runs → `renderLensBands()` fires → `onChange` eventually calls `renderLenses()`. The existing chain propagates the mode change to the right place without a second subscriber. Adding a parallel AppState subscriber that also triggers GDP render logic creates a double-render race condition.

**SingleCountryChart dispatch** follows the same pattern. `renderLenses()` is already called from `setLensState()`'s subscriber. The per-capita guard just needs to dispatch to a `renderGdpSlope()` private method instead of clearing. `SingleCountryChart` currently does not hold `AppState` — see the MetricMode access question in Phase 2 build notes below.

---

### Q2 — Should GDPScatterPanel be a new class alongside SlopeChart, or a subclass?

**Answer: new standalone class alongside `SlopeChart`.**

`SlopeChart` renders parallel-coordinate slope lines between boundary-year columns. `GDPScatterPanel` renders an XY scatterplot in 2D economic space (GDP per capita vs CO₂ per capita). The geometry, axes, scales, and data shape are entirely different. Subclassing would impose a shared `render()` signature that serves neither case, and would couple the scatter implementation to the slope's internal column/label infrastructure (`EMISSION_SOURCES`, `SourceEntry`, `buildEntries()`).

**File location:** `src/charts/GDPScatterPanel.ts`

`GDPScatterPanel` is constructed in `CombinedChart`'s constructor, mounted in the same `slopeCell` div as `SlopeChart`, and destroyed in `destroy()`. The two panels are mutually exclusive by visibility toggle (`display: none` vs `display: block`), not by DOM add/remove — toggling display avoids a re-measurement flash and avoids re-creating D3 selections on every mode switch.

**Public API:**

```typescript
class GDPScatterPanel {
  constructor(parent: HTMLElement, dataset: EmissionsDataset);
  node(): HTMLDivElement;
  destroy(): void;
  clear(): void;
  /**
   * Renders one dot per (country, year) inside each lens window.
   * X = GDP per capita, Y = co2_including_luc_per_capita, fill = STAGE_COLORS[lens.stage].
   */
  renderMultiCountry(
    countries: string[],
    lenses: StagedLensWindow[],
    dataset: EmissionsDataset,
  ): void;
}
```

**Single-country per-capita path** uses `SlopeChart` directly, not `GDPScatterPanel`. The slope for a single country in per-capita mode shows two metrics (GDP per capita + CO₂ per capita) at the lens boundary years. `SlopeChart` handles arbitrary entry arrays — it does not need modification. A new private helper `buildGdpEntries()` in `SingleCountryChart` constructs the two-entry `SourceEntry`-like array and passes it through a new `renderEntries()` overload on `SlopeChart` (see Q3 for details). This means `GDPScatterPanel` is instantiated only in `CombinedChart`; `SingleCountryChart` reuses the existing `SlopeChart` instance.

---

### Q3 — How does per-lens coloring wire through?

**Stage color as the primary dimension; existing `STAGE_COLORS` from `config.ts` is the single source.**

```typescript
export const STAGE_COLORS: Record<1 | 2 | 3, string> = {
  1: '#2e9e5b',   // green
  2: '#e08a2e',   // orange
  3: '#3b73c8',   // blue
};
```

**GDPScatterPanel (combined chart, multi-country scatter):**
Each dot corresponds to one `(country, year)` observation inside a lens window. Its fill color is `STAGE_COLORS[lens.stage]`. Country identity is not encoded in color (the scatter has no country-color scale from the line chart; encoding it would require a legend that competes with stage-color semantics). Country name appears in a hover tooltip instead.

**Dual-metric slope (single-country per-capita):**
Two lines per lens segment: CO₂ per capita and GDP per capita. Both use `STAGE_COLORS[lens.stage]` as stroke color, distinguished by stroke style — solid for CO₂ per capita, dashed for GDP per capita. This keeps stage-color semantics intact without introducing a second color dimension or a fixed color per metric.

**Wiring through SlopeChart for the single-country path:**

`SlopeChart.render()` currently builds `SourceEntry[]` internally via `buildEntries()` which calls `getSourceValue()` for each emission source. To pass pre-built entries for the GDP dual-slope, add one new public method to `SlopeChart`:

```typescript
/**
 * Renders pre-built entry sets directly, bypassing buildEntries().
 * Used by the per-capita GDP slope path in SingleCountryChart.
 */
renderEntries(
  lenses: StagedLensWindow[],
  allEntries: SourceEntry[][],
  yDomain?: [number, number],
): void
```

This method calls the existing `renderAxes()`, `renderAllLines()`, `renderAllLabels()`, and `renderScale()` helpers unchanged — those accept `SourceEntry[][]` already. The only addition is promoting `SourceEntry` from a module-private interface to an exported interface so `SingleCountryChart` can construct it.

**GDP per capita data access:**

The CSV has `gdp` (total GDP, constant dollars, column 5) and `population` (column 4). There is no pre-computed `gdp_per_capita` column — derivation is `gdp / population` at render time. Both columns must be added to `EXTRA_COLUMNS` in `config.ts` (one-line addition each):

```typescript
// config.ts — add to EXTRA_COLUMNS
'gdp',
'population',
```

Access pattern follows `getSourceValue()`:

```typescript
// src/utils/getGdpPerCapita.ts — new file
export function getGdpPerCapita(
  dataset: EmissionsDataset,
  country: string,
  year: number,
): number | undefined {
  const series = dataset.series(country);
  const point = series?.points.find(p => p.year === year);
  if (!point) return undefined;
  const gdp = point.extra['gdp'];
  const pop = point.extra['population'];
  return Number.isFinite(gdp) && Number.isFinite(pop) && pop > 0
    ? gdp / pop
    : undefined;
}
```

**Note on in-browser derivation:** The OWID CSV does not expose a `gdp_per_capita` column directly. The derivation `gdp / population` is confirmed correct: Germany 2020 gdp=3 742 721 113 842, population=83 628 711 → ~44 754 USD/person, consistent with published World Bank figures. Missing GDP data is common for smaller/earlier years; `getGdpPerCapita()` returns `undefined` and the scatter silently omits that dot (matching how `getSourceValue()` handles missing data).

---

### Q4 — Suggested build order for phases

```
[Phase 1] Data layer ← no visual change; unlocks everything else
    ↓
[Phase 2] SingleCountryChart per-capita dual slope ← isolated, easy to verify
    ↓
[Phase 3] GDPScatterPanel class ← new file, no chart wiring yet
    ↓
[Phase 4] CombinedChart dispatch + GDPScatterPanel wiring ← visible combined effect
    ↓
[Phase 5] Polish: axis labels, tooltips, unit annotations, weighted toggle hiding
```

**Phase 1 — Data layer** (zero visual change, unblocks all derivation)
- Add `'gdp'` and `'population'` to `EXTRA_COLUMNS` in `config.ts`
- Create `src/utils/getGdpPerCapita.ts`
- `npm run build` must pass — no rendered change yet

**Phase 2 — SingleCountryChart per-capita dual slope**
- Export `SourceEntry` from `SlopeChart.ts` and add `renderEntries()` public overload
- In `SingleCountryChart`, branch `renderSlope()` on MetricMode:
  - `'absolute'` → existing source breakdown (unchanged)
  - `'per-capita'` → call `slopeChart.renderEntries()` with the two-entry GDP dual-slope

  The MetricMode access problem: `SingleCountryChart` does not currently hold `AppState`. Two options:
  - **Option A (recommended):** inject `AppState` into the `SingleCountryChart` constructor. `ChartArea` already holds `AppState`; it passes it through when constructing each `SingleCountryChart`. Cleaner long-term because future milestones may need other state reads inside the chart.
  - **Option B:** add a `setMetricMode(mode: MetricMode)` setter and call it from `ChartArea.reconcile()`. Avoids touching the constructor signature but adds a mutable property to set/forget.

  The existing `includeLUC` instance field (`this.includeLUC`, set in `update()`) is precedent for "chart holds its own copy of a state flag." Option A replaces that pattern; Option B extends it. Either compiles — pick based on how much of `AppState` the chart is likely to need going forward.

**Phase 3 — GDPScatterPanel class**
- Create `src/charts/GDPScatterPanel.ts`
- `renderMultiCountry(countries, lenses, dataset)`: collect `(country, year)` pairs for all years in `[lens.startYear .. lens.endYear]`, compute GDP per capita and `co2_including_luc_per_capita` from `point.extra`, draw D3 scatterplot with `STAGE_COLORS[lens.stage]` fill
- X axis: GDP per capita (USD); Y axis: CO₂ per capita (t/person)
- Add `GDPScatterPanel` instance to `CombinedChart` constructor; mount it in `slopeCell`; `display: none` initially
- `npm run build` must pass — panel is mounted but never shown yet

**Phase 4 — CombinedChart dispatch wiring**
- Modify `CombinedChart.renderLenses()` dispatch as shown in Q1
- Add `CombinedChart.renderGdpView(lenses)` private method
- Toggle `SlopeChart` / `GDPScatterPanel` visibility in `renderLenses()` based on mode
- Hide the weighted-mean toggle when `metricMode === 'per-capita'` (it is meaningless for individual-country dots)

**Phase 5 — Polish**
- Axis labels on `GDPScatterPanel` (X: "GDP per capita (USD)", Y: "CO₂ per capita (t/person)")
- Hover tooltip: country name + both values at hovered point
- "No data" notice when all countries in the lens window have missing GDP
- Unit annotation on the dual-metric slope Y axis ("t CO₂/person" vs "USD/person" require two Y axes or normalization — start with a note in the label)

---

## Full Component Boundary Map

| Component | File | Role | Change for v1.3 |
|-----------|------|------|-----------------|
| `AppState` | `state/AppState.ts` | MetricMode source of truth | No change |
| `CountryLensState` | `state/CountryLensState.ts` | Placed lens registry | No change |
| `LensSync` | `charts/LensSync.ts` | Cross-chart gesture fan-out | No change |
| `EmissionsDataset` | `data/EmissionsDataset.ts` | CSV index + point.extra | No change |
| `resolveColumn` | `utils/resolveColumn.ts` | CO₂ column name dispatch | No change |
| `metricSpec` | `utils/metricSpec.ts` | Axis label + formatter | No change |
| `getSourceValue` | `utils/getSourceValue.ts` | Reads point.extra by key | No change |
| `crossCountryMean` | `utils/crossCountryMean.ts` | Aggregated slope for combined chart | No change (unused in per-capita path) |
| `getGdpPerCapita` | `utils/getGdpPerCapita.ts` | GDP/pop derivation | **NEW** |
| `EXTRA_COLUMNS` | `config.ts` | Columns retained in point.extra | **EXTEND**: add `'gdp'`, `'population'` |
| `SlopeChart` | `charts/SlopeChart.ts` | Parallel-coord slope panel | **MODIFY**: export `SourceEntry`; add `renderEntries()` overload |
| `GDPScatterPanel` | `charts/GDPScatterPanel.ts` | XY scatter for combined per-capita | **NEW** |
| `SingleCountryChart` | `charts/SingleCountryChart.ts` | Single extracted country | **MODIFY**: MetricMode-aware `renderSlope()`; inject or pass MetricMode |
| `CombinedChart` | `charts/CombinedChart.ts` | Multi-country combined view | **MODIFY**: `renderLenses()` dispatch; add `renderGdpView()`; add `GDPScatterPanel` instance |
| `ChartArea` | `charts/ChartArea.ts` | Orchestrator + drag | **MODIFY if Option A**: pass AppState to `SingleCountryChart` constructor |

---

## Data Flow Diagrams

### Path A — Combined chart, per-capita, lenses active → GDPScatterPanel

```
CountryLensState.notify()
  → CombinedChart.renderLenses()
      metricMode === 'per-capita' && lenses.length > 0
      → CombinedChart.renderGdpView(lenses)
          for each country in this.countries:
            for each lens in lenses:
              for each year in [lens.startYear .. lens.endYear]:
                x = getGdpPerCapita(dataset, country, year)
                y = point.extra['co2_including_luc_per_capita']
                color = STAGE_COLORS[lens.stage]
          → GDPScatterPanel.renderMultiCountry(countries, lenses, dataset)
              D3 scatterplot render, X/Y axes, dots, tooltip
```

### Path B — Single-country chart, per-capita, lenses active → dual-metric SlopeChart

```
CountryLensState.notify()
  → SingleCountryChart.renderLenses()
      metricMode === 'per-capita' && lenses.length > 0
      → SingleCountryChart.renderGdpSlope(lenses)
          for each lens:
            entries = [
              { key: 'gdp_per_capita',    label: 'GDP/capita',  color: STAGE_COLORS[lens.stage],
                leftValue:  getGdpPerCapita(dataset, country, lens.startYear),
                rightValue: getGdpPerCapita(dataset, country, lens.endYear) },
              { key: 'co2_per_capita',    label: 'CO₂/capita',  color: STAGE_COLORS[lens.stage],
                leftValue:  getSourceValue(dataset, country, 'co2_including_luc_per_capita', lens.startYear),
                rightValue: getSourceValue(dataset, country, 'co2_including_luc_per_capita', lens.endYear) },
            ]
          → SlopeChart.renderEntries(lenses, [entries], yDomain)
              existing renderAllLines / renderAllLabels / renderAxes — no other changes
```

### AppState mode-change propagation (no new subscribers needed)

```
AppState.setMetricMode()
  → AppState.notify()
      → CombinedChart.update()           (via existing state.subscribe)
          → renderLensBands()
              → onChange() → renderLenses()  ← mode-aware dispatch fires here
      → ChartArea.reconcile()            (via existing state.subscribe in ChartArea)
          → SingleCountryChart.update()
              → if AppState injected: renderLenses() reads fresh metricMode directly
```

---

## Architecture Anti-Patterns to Avoid

**Anti-Pattern 1: New AppState subscriber in chart classes for MetricMode**
A second subscriber in `CombinedChart` that watches MetricMode and calls `renderGdpView()` directly creates two render paths that can fire in undefined order when AppState changes. The existing `update() → renderLensBands() → onChange → renderLenses()` chain already covers it.

**Anti-Pattern 2: Destroying and recreating GDPScatterPanel on mode switch**
DOM removal triggers dimension reflow on the next show, causing measurement errors. Both `SlopeChart` and `GDPScatterPanel` must always exist in the slope cell; only their CSS `display` property is toggled.

**Anti-Pattern 3: Computing GDP per capita inside EmissionsDataset.index()**
Embedding a derived column into the data layer obscures the derivation and creates an untestable dependency on two raw columns being co-present. Keep it as a utility called at render time, mirroring how `getSourceValue()` works.

**Anti-Pattern 4: Adding metricMode to SingleCountryChart.update() parameter list**
`update(yearRange, includeLUC, metricMode?)` grows unboundedly each milestone. The `includeLUC` field is already stored as an instance property set during `update()`. If `metricMode` is added the same way, there are eventually four flags on separate call sites to keep synchronized. Inject `AppState` once in the constructor instead.

**Anti-Pattern 5: Using crossCountryMean for GDP scatter data**
`crossCountryMean` computes mean source values across countries per lens boundary year. The scatter needs individual `(country, year)` dot points across the full lens window interior — a different shape entirely. Write a dedicated collection loop inside `GDPScatterPanel.renderMultiCountry()`; do not adapt `crossCountryMean`.

**Anti-Pattern 6: Two Y axes on the dual-metric slope**
GDP per capita (USD ~10 000–100 000) and CO₂ per capita (t 1–30) differ by three orders of magnitude. Two D3 Y axes in the same SlopeChart SVG without normalization produce lines that visually diverge. Use normalized scale (each metric rescaled to [0, 1]) for Phase 2, or — simpler — show the two metrics on separate adjacent SlopeChart instances stacked vertically. The normalized approach is cleaner but can mislead; the stacked approach is honest about units. Decide before implementing Phase 2.

---

## Key Existing Patterns to Follow

**group() idempotent layer management** — all chart classes use `data([null]).join('g')` for SVG layers. `GDPScatterPanel` must do the same for its axes, dots, and tooltip layers.

**requestAnimationFrame deferral** — both `CombinedChart` and `SingleCountryChart` defer slope render by one frame to allow the flex layout to reflow. `renderGdpView()` and `renderGdpSlope()` must use the same defer pattern.

**STAGE_COLORS as single color source** — import from `config.ts` only; never hardcode hex values in chart or panel files.

**getSourceValue pattern for point.extra reads** — find point by year, read `point.extra[key]`, return `undefined` on NaN or missing. `getGdpPerCapita` follows exactly this shape with an added division step.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Q1 dispatch location | HIGH | `renderLenses()` already has the MetricMode read; confirmed from source |
| Q2 class vs subclass | HIGH | Geometry difference makes subclassing clearly wrong |
| Q3 color wiring | HIGH | `STAGE_COLORS` is already the system; no new constants needed |
| Q4 build order | HIGH | Dependencies are explicit and confirmed; no circular issues |
| GDP/population derivation | HIGH | Confirmed no `gdp_per_capita` column; derivation verified against Germany 2020 (44 754 USD/person) |
| `gdp` and `population` in CSV | HIGH | Both columns confirmed present in CSV header at positions 5 and 4 |
| Two-Y-axis scale conflict | MEDIUM | Decision (normalized vs stacked) must be made before Phase 2 implementation |
| MetricMode access in SingleCountryChart | MEDIUM | Option A (inject AppState) is recommended but slightly wider constructor change |

---

## Sources

- Full read of all 46 TypeScript source files in `src/`
- `CLAUDE.md` project conventions (build constraint, OCP principle)
- `.planning/PROJECT.md` milestone v1.3 requirements (UC1-07 through UC1-15, active requirements)
- OWID CSV header inspection — columns 4 (`population`), 5 (`gdp`), 14 (`co2_including_luc_per_capita`), 17 (`co2_per_capita`)
- Germany 2020 row verification: gdp=3 742 721 113 842, population=83 628 711
