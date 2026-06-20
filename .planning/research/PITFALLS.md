# Pitfalls Research

**Project:** ProjectLens v1.3 — GDP Lens (mode-aware panel + scatterplot)
**Researched:** 2026-06-20
**Confidence:** HIGH

This document supersedes the v1.2 PITFALLS.md and adds pitfalls specific to the GDP
lens milestone. The focus is integration risk: what breaks in the existing slope-panel
and lens system when (a) the panel switches behavior based on MetricMode, (b) `gdp`
and `population` columns must be derived in-browser from nullable OWID data, (c) a
multi-lens accumulating scatterplot is added to the same 1/3-width panel area, and
(d) axis domains must be coordinated across multiple lenses that share one scatter
canvas.

---

## Critical Pitfalls

### Pitfall 1: `gdp` and `population` Not Added to EXTRA_COLUMNS Before Derived Division

**What goes wrong:**
`getSourceValue()` reads from `point.extra[sourceKey]`. If `'gdp'` and `'population'`
are not listed in `EXTRA_COLUMNS` in `config.ts`, `EmissionsDataset.load()` does not
store them in `point.extra` — the fields are simply absent. Every GDP per capita
calculation returns `undefined`, the scatterplot is empty, and there is no error
anywhere: `getSourceValue()` returns `undefined` silently and the dots are never drawn.

The same applies to any extra column used by the single-country GDP slope chart
(e.g. needing raw `population` to reverse-engineer the per-capita co2 values).

**Why it happens:**
Developers test by adding the derived calculation and checking the scatterplot, but the
dataset was loaded at app startup before their code change was deployed. They reload and
see dots, but only because they happened to add the column; if they forget, the silent
`undefined` path looks like "country has no GDP data" rather than "column not loaded."
The existing `co2_including_luc_per_capita` precedent (v1.2 Pitfall 5) establishes this
pattern but the GDP-specific columns are new.

**How to avoid:**
Add `'gdp'` and `'population'` to `EXTRA_COLUMNS` in `config.ts` as the **first commit**
of the GDP feature. Verify in the browser console:
```ts
dataset.series('Germany')?.points.find(p => p.year === 2000)?.extra['gdp']
// must be a finite number, not undefined or NaN
```
Run `npm run build` after this change before writing any derived calculation.

**Warning signs:**
Scatterplot renders no dots despite lenses being active. `getSourceValue()` for `'gdp'`
returns `undefined` for every country-year. No console error is thrown.

**Phase to address:**
Data layer phase (first). Must be done before any GDP computation or rendering code.

---

### Pitfall 2: GDP Per Capita Division by Zero or NaN — Silent Propagation to Scatterplot

**What goes wrong:**
`gdp / population` produces `NaN` when `population` is 0 or `NaN`, and `Infinity`
when `population` is exactly 0. Both values pass silently into D3's scale domain
calculation, causing `scaleLinear().domain([NaN, Infinity])` which renders every dot at
`NaN` pixels — typically appearing at (0, 0) or outside the SVG viewport entirely. The
scatterplot appears empty or all dots pile at the origin.

Additionally, OWID rows frequently have `gdp` present but `population` absent (or vice
versa) for a given country-year. This means `NaN` rows appear mixed with valid rows,
and `Math.min(...values)` / `Math.max(...values)` returns `NaN` when any value in the
spread is `NaN`, collapsing the domain.

**Why it happens:**
`EmissionsDataset.parse()` converts empty strings to `NaN` (correct). Developers write
the derived ratio inline in the rendering loop:
```ts
const gdpPerCapita = point.extra['gdp'] / point.extra['population'];
```
Without a finite-check guard, `NaN / NaN = NaN` and `1000 / 0 = Infinity` both pass
through to the domain-building accumulator. `Number.isFinite()` is not called.

In `crossCountryMean`, the existing pattern already handles this: `if (!Number.isFinite(v)) continue;`. The GDP lens must follow the same pattern exactly.

**How to avoid:**
Compute the derived ratio in a helper that returns `undefined` (not `NaN`) on any
non-finite operand:
```ts
function gdpPerCapita(point: RawPoint): number | undefined {
  const gdp = point.extra['gdp'];
  const pop = point.extra['population'];
  if (!Number.isFinite(gdp) || !Number.isFinite(pop) || pop === 0) return undefined;
  return gdp / pop;
}
```
Build the scatter data array with only entries where this returns a defined value.
Compute domain bounds using `Array.reduce` with explicit `Number.isFinite` guards, never
`Math.min(...array)` directly on a potentially-nullable array.

**Warning signs:**
All scatter dots appear at (0, 0) or are invisible. The x or y axis shows `NaN` as a
tick label. `scaleLinear().domain([NaN, NaN])` returns a scale where every input maps
to `NaN`.

**Phase to address:**
GDP computation utility phase — must be a guard in the helper before any D3 rendering
code is written.

---

### Pitfall 3: Mode Switch Leaves Stale Slope DOM When Transitioning Absolute → Per-Capita

**What goes wrong:**
A lens is placed on a single-country chart while in absolute mode. The slope chart
renders source-breakdown lines. The user then switches to per-capita mode (activating
the GDP lens feature). The existing slope DOM — axes, source lines, year labels, scale
— is not cleared because the mode switch triggers `renderLenses()` which calls
`this.slopeChart.clear()`, but only if the `active` condition is false. When a lens
is still active and mode changes, `active` is `true`, so `clear()` is not called, and
the slope chart's source lines remain visible behind the new GDP scatterplot content
(or instead of it, if the GDP scatterplot renders into a different DOM node).

More specifically: if `renderSlope()` in `SingleCountryChart` is modified to branch on
`metricMode` but the slope chart is reused for both modes, the `clear()` call must be
issued at the start of the per-capita branch before new GDP content is painted. If it
is not, old slope lines remain underneath.

**Why it happens:**
The existing `renderLenses()` logic:
```ts
if (active) {
  requestAnimationFrame(() => this.renderSlope(lenses));
} else {
  this.slopeChart.clear();
}
```
clears only when there are no lenses. A mode change while a lens is active takes the
`if (active)` branch and schedules `renderSlope()` — which must now distinguish
absolute vs. per-capita. If the developer adds the distinction inside `renderSlope()`
but forgets to clear the slope chart before rendering the GDP view, stale absolute
source lines persist.

**How to avoid:**
At the entry point of the per-capita GDP branch inside `renderSlope()` (or its
replacement), always call `this.slopeChart.clear()` **before** invoking any GDP rendering
method. Alternatively, keep the slope chart for absolute mode and introduce a separate
GDP panel component that is shown/hidden via CSS class, so the two rendering paths
share no DOM state. The latter is cleaner for the open/closed principle already
established in the codebase.

**Warning signs:**
Source breakdown lines (coal, oil, gas etc.) remain visible in the panel after
switching to per-capita mode. The GDP scatterplot dots, if rendered at all, appear on
top of the old lines.

**Phase to address:**
Mode-dispatch phase — the first commit that wires `metricMode()` into the panel render
path.

---

### Pitfall 4: Scatterplot Axis Domains Collapse or Overflow When Multiple Lenses Are Active

**What goes wrong:**
Each lens window contributes a set of (gdpPerCapita, co2PerCapita) points for every
country-year in that window. When multiple lenses are active (e.g. stage 1 + stage 2),
the domain for the shared scatter axes must span the union of all points across all
lenses. If the x- and y-domain are computed per-lens and then each lens re-renders the
axes independently, the second lens re-renders the axes with its own narrower domain,
clipping dots from the first lens off-screen — they still exist in the DOM but are
positioned outside the SVG viewport.

Conversely, if the domain is computed greedily at first render and not recomputed when
a lens is added or removed, adding a lens with extreme outlier values (e.g. a
high-GDP oil state like Qatar in an early year) blows out the domain and compresses all
other country dots into a dense cluster near the origin.

**Why it happens:**
D3 scatterplots typically compute domain from the data array at render time. Multi-pass
rendering (one call per lens) requires a two-pass approach: (1) collect all points from
all lenses, compute union domain, build shared scales; (2) render each lens's dots using
those shared scales. Single-pass implementations compute domain inside the per-lens
render call and overwrite the scales on each iteration.

**How to avoid:**
Always compute the shared domain from the **union of all lens windows** before rendering
any dots. Structure the scatter render as two explicit phases:
```ts
// Phase 1: collect all valid points from all lenses
const allPoints = lenses.flatMap(lens => collectScatterPoints(lens, dataset, countries));
// Phase 2: build shared scales
const xDomain = [d3.min(allPoints, d => d.gdp)!, d3.max(allPoints, d => d.gdp)!];
const yDomain = [0, d3.max(allPoints, d => d.co2)!];
const x = scaleLinear().domain(xDomain).nice().range([0, innerW]);
const y = scaleLinear().domain(yDomain).nice().range([innerH, 0]);
// Phase 3: render each lens's dots using the same x, y scales
for (const lens of lenses) renderLensDots(lens, x, y, ...);
```
Axes are rendered once, after phase 2. Dots are rendered per-lens with stage color.

**Warning signs:**
Adding a second lens causes dots from the first lens to disappear (move off-screen) or
the axes rescale and all dots shift position simultaneously. Removing a lens does not
restore the domain — dots from remaining lenses are still crowded.

**Phase to address:**
Scatterplot rendering phase — enforce the two-pass domain collection in the initial
design, not as a fix after seeing the clipping bug.

---

### Pitfall 5: Stale Scatter Dots From Removed Lenses Remain in the DOM

**What goes wrong:**
When a lens is removed, the scatterplot must re-render from scratch with only the
remaining lenses' data. If each lens's dots are appended as SVG elements without a D3
data-join key, removing a lens does not cause those dots to be removed from the DOM.
The `g.lens-1-dots` group stays populated after lens 1 is removed; only the lens band
disappears. The dots remain but are now misleading (they represent a time window that
no longer has a lens).

This is the "accumulating stale data" problem described in the milestone context. It is
worse in the multi-lens case because dots from all three stages may be present and the
user cannot tell which stage's dots belong to which lens.

**Why it happens:**
D3 data-joins require a key function that maps DOM elements to data items. If dots are
appended with `.append()` instead of `.join()`, they accumulate. Even with `.join()`,
if the key function does not uniquely identify a lens-country-year triplet, stale dots
from a prior render may survive.

**How to avoid:**
Key every circle by `lensId-country-year`:
```ts
const dotData = lenses.flatMap(lens =>
  collectScatterPoints(lens, dataset, countries)
    .map(pt => ({ ...pt, key: `${lens.id}-${pt.country}-${pt.year}` }))
);
g.selectAll<SVGCircleElement, ScatterPoint>('circle.scatter-dot')
  .data(dotData, d => d.key)
  .join('circle')
  ...
```
Since `lens.id` is stable within a render cycle but unique across lenses, removing a
lens removes all keys that contain its `id`, and D3 exit selection removes those circles.

Re-render the entire scatterplot (all dots at once, not per-lens in separate calls) on
every lens state change. This is O(n × k) where n = countries and k = years per window,
which for typical lens sizes (3–40 years × <50 countries) is well within browser limits.

**Warning signs:**
Dot count increases monotonically as lenses are added and never decreases when lenses
are removed. Stage-colored dots from removed lenses remain visible.

**Phase to address:**
Scatterplot rendering phase — the key function and `.join()` pattern must be in the
initial implementation.

---

### Pitfall 6: Single-Country GDP Slope (Per-Capita Mode) Reuses SlopeChart Internals That Hardcode "million tonnes"

**What goes wrong:**
`SlopeChart.ts` has a `renderScale()` method that hardcodes the unit label
`'million tonnes'`:
```ts
g.selectAll<SVGTextElement, string>('text.slope-chart__scale-title')
  .data(['million tonnes'])
  ...
```
If the GDP slope view (single-country, per-capita mode) is built by calling
`slopeChart.render()` or `slopeChart.renderAggregated()` with GDP per capita and
CO₂ per capita values, the y-axis unit label will incorrectly say "million tonnes"
instead of "t CO₂/person" or "USD/person". The numeric range will also differ vastly
(GDP per capita values are in the tens of thousands of USD, not in millions of tonnes).

**Why it happens:**
`SlopeChart` was designed for a single use case (emission source breakdown). Its public
`render()` API accepts `StagedLensWindow[]` and computes values via `getSourceValue()`.
There is no parameter for unit labels or value formatters. Developers either (a) jam GDP
values through the existing `render()` path by treating them as "source values" (which
works numerically but shows wrong labels) or (b) add a unit parameter to `renderScale()`
without updating all callers (which breaks the build under strict TS).

**How to avoid:**
Do not repurpose `SlopeChart` for GDP slope rendering. The open/closed principle
already guides this: add a new `GdpSlopeChart` class (or a `GdpSlopePanel` renderer
function) that handles the per-capita two-variable slope independently. This component
owns its own axis labels, value formatters, and data contract. `SlopeChart` remains
unchanged, serving only the absolute emission source breakdown.

If code sharing is desired, extract shared helpers (e.g. `columnPositions()`,
`bumpLabels()`) as standalone utility functions that both classes import.

**Warning signs:**
GDP values in the slope chart panel are labeled "million tonnes". The y-axis shows
values in the thousands (GDP) while the label says "Mt". TypeScript build succeeds but
the visual output is semantically wrong.

**Phase to address:**
GDP panel architecture phase — decide on a separate component before writing any
rendering code. This is an architectural decision, not an implementation detail.

---

### Pitfall 7: AppState MetricMode Change Triggers Slope Render Before GDP Scatter Is Wired

**What goes wrong:**
`CombinedChart.renderLenses()` listens to `CountryLensState` changes. `CombinedChart`
also subscribes to `AppState` changes via `state.subscribe(() => this.update())`.
When `MetricMode` changes, `update()` fires. Inside `update()`, `renderLensBands()`
is called which calls `onChange()`, which can trigger `renderLenses()` again via the
lens state subscriber. If the GDP scatter rendering path is not yet wired by the time
`renderLenses()` fires, the chart falls through to the existing slope render path
(`this.slopeChart.renderAggregated(...)`) — rendering a broken slope chart (wrong
units, potentially wrong domain) for per-capita lenses instead of the new GDP scatter.

This re-entrancy risk is documented in `LensSync.ts`:
> Does NOT subscribe to CountryLensState — it calls mutators directly to avoid
> the notify→render→mutate re-entrancy risk

**Why it happens:**
The `renderLenses()` method in `CombinedChart` already has a partial per-capita guard:
```ts
if (active && !perCapita) {
  requestAnimationFrame(() => this.renderSlope(lenses));
} else {
  this.slopeChart.clear();
}
```
If a developer wires the GDP scatter in a separate step (not in the same commit), the
`else` branch will fire correctly (clearing slope) but will not yet show the GDP scatter.
The window between "slope suppressed" and "GDP scatter rendered" is a blank panel.

This is acceptable during development but must not be merged to main as a half-wired
state: the GDP scatter must be fully connected when the per-capita guard is activated.

**How to avoid:**
Implement the mode-dispatch and the GDP scatter rendering in a single atomic commit.
The `else` branch must be:
```ts
} else if (perCapita && active) {
  requestAnimationFrame(() => this.renderGdpScatter(lenses));
} else {
  this.slopeChart.clear();
}
```
Both the `renderGdpScatter()` method and its call site must exist in the same PR.

**Warning signs:**
In per-capita mode with an active lens, the panel area is blank — neither slope lines
nor scatter dots appear. No error in the console. The MetricMode guard is working
(suppressing slope) but the GDP scatter is not yet connected.

**Phase to address:**
Mode-dispatch and GDP scatter rendering phase — these must be a single deliverable, not
split across commits.

---

### Pitfall 8: D3 selectAll Key Collision Between Slope and Scatter Layers in Shared SVG

**What goes wrong:**
`SlopeChart` manages its own SVG and groups internally. If the GDP scatterplot is
rendered into the same SVG element (or into the same slope cell `<div>`) by appending
to the existing `SlopeChart.svg`, the group selectors collide. For example,
`SlopeChart.group('axes')` selects `g.axes` inside its plot group — but if the GDP
scatter also appends a `g.axes` group in the same SVG hierarchy, the first component
to call `group('axes').selectAll('*').remove()` wipes the other's axis elements.

This is a DOM namespace conflict, not a logical bug. It is silent until both components
are visible simultaneously.

**Why it happens:**
`SlopeChart` encapsulates its SVG: `this.plot = this.svg.append('g')...`. A second
renderer appended to the same parent `<div>` would create a second SVG (safe). But if a
developer appends directly to `slopeCell.node()!` — the same container that
`SlopeChart` is constructed into — and the GDP renderer also calls
`select(slopeCell).append('svg')`, there are now two SVGs in the same cell, which is
fine. The risk is if the GDP renderer reuses the `SlopeChart`'s `svg` reference directly.

**How to avoid:**
Give the GDP scatter panel its own container. In `SingleCountryChart` and
`CombinedChart`, construct the GDP panel into a dedicated `<div>` sibling (or
replace the `slopeCell` content entirely when switching modes). Never share the SVG
element between the slope chart and the GDP scatter renderer.

```
single-country-chart__body
  ├── single-country-chart__line  (line chart SVG)
  └── single-country-chart__panel (slope OR scatter, not both simultaneously)
       ├── .slope-chart  (managed by SlopeChart — visible in absolute mode)
       └── .gdp-panel    (managed by GdpPanel — visible in per-capita mode)
```
Show/hide via CSS class on the panel container based on `metricMode`.

**Warning signs:**
Toggling between absolute and per-capita mode causes partial content from the other
mode to remain (axis lines without labels, or labels without dots). `g.axes` element
is removed and not repopulated correctly.

**Phase to address:**
GDP panel architecture phase — DOM structure must be decided before any rendering code.

---

### Pitfall 9: OWID `gdp` Column Is GDP in Constant 2011 USD (PPP) — Axis Label Misleads

**What goes wrong:**
The OWID `gdp` column is GDP in constant 2011 international USD (purchasing power
parity), not nominal USD. If the axis is labeled "GDP per capita (USD)" without this
qualification, the visualization is technically correct but analytically misleading.
Comparing two countries with very different purchasing power levels may lead to
incorrect inferences about relative wealth.

Additionally, the `gdp` column covers fewer country-years than CO₂ columns. Many
developing-country rows in years before 1990 have `gdp = NaN`. This means some
country-year dots that appear in the CO₂ line chart will be absent from the scatterplot
without explanation.

**Why it happens:**
Developers treat all OWID columns as equivalent and label axes by column name. The
nuance of PPP adjustment is not surfaced in the column name itself.

**How to avoid:**
Label the x-axis as "GDP per capita (2011 int. $, PPP)" in the GDP panel. Add a brief
annotation or tooltip explaining the PPP adjustment. Where `gdp` is `NaN` for a
country-year that has `co2_per_capita`, omit the dot from the scatter (correct per
Pitfall 2) and consider adding a note: "Some country-years are missing GDP data."

**Warning signs:**
Axis label reads "GDP / population (USD)" or "GDP per capita" without the PPP/constant
qualifier. Users assume current-USD nominal comparison.

**Phase to address:**
GDP panel labeling phase — axis label string should be reviewed before the feature is
demoed.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Compute `gdp / population` inline in the render loop without extracting a helper | Fewer files | NaN propagation is duplicated everywhere gdpPerCapita is needed; no single place to add guards | Never — extract `gdpPerCapita(point)` returning `number \| undefined` |
| Reuse `SlopeChart.render()` for the GDP slope by treating GDP/population as a "source" | No new class needed | Unit label is wrong; data contract does not match; adding a unit parameter breaks all callers | Never — create `GdpSlopePanel` (or similar) |
| Compute scatter domain per-lens rather than as a union | Simpler loop | Second lens re-scales axes and moves all prior dots off-screen | Never — always union domains before rendering any dots |
| Use `append('circle')` inside a lens loop instead of a single `.join()` with keys | Simpler code | Dots accumulate across renders; removing a lens leaves ghost dots | Never — always use keyed `.join()` |
| Place GDP scatter in the existing `SlopeChart` SVG element | Only one SVG per panel | Group name collisions corrupt both renderers' DOM state silently | Never — give GDP panel its own SVG/container |
| Skip the PPP label qualifier on the x-axis | Cleaner label | Misleads analytical comparison between countries; academically inaccurate | Never in the final submission |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `EmissionsDataset` + `'gdp'` column | Not adding `'gdp'` and `'population'` to `EXTRA_COLUMNS` — columns exist in CSV but are not stored in `point.extra` | Add both to `EXTRA_COLUMNS` in `config.ts` as the first commit; verify with console inspection of `point.extra` |
| `CombinedChart.renderLenses()` + MetricMode | Adding GDP scatter in a separate commit from the slope suppression guard, leaving the panel blank in per-capita mode between commits | Implement mode dispatch and GDP scatter render in one atomic PR |
| `SlopeChart` + GDP content | Calling `slopeChart.render()` with GDP values to avoid creating a new class | Create `GdpSlopePanel`; `SlopeChart` unit label and data contract are incompatible with GDP values |
| D3 data-join + multi-lens dots | Using `append('circle')` inside a per-lens loop instead of a single keyed `.join()` across all lens data | Flatten all lens data with `lensId-country-year` keys into one array; call `.join()` once |
| Domain computation + nullable GDP | Using `Math.min(...allValues)` where `allValues` may contain `undefined` items (spread of a nullable array) | Use `Array.reduce` with `Number.isFinite` guard; never spread a potentially-nullable array into `Math.min` |
| `SingleCountryChart` + `AppState` subscription | `SingleCountryChart` does not currently subscribe to `AppState` directly — it receives `yearRange` and `includeLUC` as parameters from `ChartArea.update()`. Adding GDP slope requires it to also know `metricMode()`, which it does not currently receive. | Either (a) pass `metricMode` as a parameter to `update()`, mirroring `includeLUC`, or (b) give `SingleCountryChart` a reference to `AppState` the same way `CombinedChart` already has one. Option (b) is cleaner given the chart already has per-lens subscriptions. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Recomputing `gdp / population` for every country-year on every render | Noticeable jank with many countries selected and a wide lens window | Compute derived values once during data collection phase; cache in the scatter data array | With 50+ countries and a 40-year lens window (2000 point operations per render) |
| Calling `dataset.series(country)?.points.find(p => p.year === year)` inside a loop for each lens-country-year | O(n²) scan: for each dot, scan all points linearly | `getSourceValue` already uses `.find()` which is O(n). For scatter rendering over a year range (not a single year), build a `Map<year, RawPoint>` per country once, then do O(1) lookups | When lens window spans 40 years × 50 countries = 2000 `.find()` scans of ~250-point series per render |
| Re-rendering entire scatterplot on every `mousemove` or crosshair event | Continuous jank during hover | Scatterplot must only re-render on lens state change or metric mode change, not on crosshair/tooltip events | Immediately if crosshair hover triggers a state notification that the scatter subscribes to |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No visual distinction between lens stages in scatterplot | All dots look the same; user cannot tell which stage produced which dots | Color dots by stage (`STAGE_COLORS[lens.stage]`) — this is already established for slope lines; apply the same pattern to scatter dots |
| Scatter dots for years within the lens window are indistinguishable from each other | Users cannot see trends within a lens window; it looks like random scatter | Consider encoding year as dot size or opacity gradient (lighter = older). Even just a tooltip showing country + year on hover adds analytical value |
| Mode switch while a lens is active shows blank panel for one frame | Brief flash of empty panel | Call `slopeChart.clear()` synchronously before scheduling `renderGdpScatter()` via `requestAnimationFrame`; the clear is instant, the GDP render follows on the next frame |
| Scatterplot x/y axes lack units | User cannot interpret axis scales | Always label axes: x = "GDP per capita (2011 int. $, PPP)", y = "CO₂ per capita (t CO₂/person)" |

---

## "Looks Done But Isn't" Checklist

- [ ] **GDP column loaded:** `dataset.series('Germany')?.points.find(p => p.year === 2000)?.extra['gdp']` returns a finite number in the browser console — not `undefined` or `NaN`.
- [ ] **Population column loaded:** Same check for `'population'` — OWID has this column for most countries.
- [ ] **Null GDP handled:** Select a country known to have sparse GDP data (e.g. a small island state). Confirm no NaN dots appear at (0, 0) and the domain computation does not collapse.
- [ ] **Scatterplot clears on lens removal:** Place two lenses. Remove one. Confirm only the remaining lens's dots are visible — count the dots before and after.
- [ ] **Domain spans all lenses:** Place a stage-1 lens on high-GDP year range and a stage-2 lens on low-GDP year range. Confirm all dots from both lenses are visible — none clipped off-screen.
- [ ] **Slope chart clears on per-capita switch:** Place a lens in absolute mode (slope appears). Switch to per-capita. Confirm slope lines are gone and GDP scatter appears (not blank).
- [ ] **Slope chart restores on absolute switch:** Switch back to absolute mode. Confirm slope source lines reappear correctly.
- [ ] **Stage colors on dots:** Stage-1 lens produces green dots (`#2e9e5b`), stage-2 produces orange (`#e08a2e`), stage-3 produces blue (`#3b73c8`). Verify using the browser inspector.
- [ ] **Axis labels include units and PPP qualifier:** x-axis label contains "2011" or "PPP"; y-axis contains "t CO₂/person" or equivalent.
- [ ] **No group selector collision:** Toggle absolute/per-capita 5 times rapidly. Confirm neither panel shows artifacts from the other mode.
- [ ] **Build passes:** `npm run build` passes after every change. GDP column names are strings, not typed keys — TS will not catch column name typos; verify by column inspection.

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| GDP/population not in EXTRA_COLUMNS (Pitfall 1) | Data layer phase — first commit | Console inspection of `point.extra['gdp']` before any other code |
| NaN division propagation (Pitfall 2) | GDP computation utility phase | Select a country with sparse GDP data; confirm no NaN domain; no dots at (0,0) |
| Stale slope DOM after mode switch (Pitfall 3) | Mode-dispatch phase | Toggle absolute/per-capita with active lens; inspect DOM for residual slope elements |
| Scatter domain collapses across lenses (Pitfall 4) | Scatterplot rendering phase | Add second lens; verify all dots from both lenses remain visible without rescaling |
| Ghost dots from removed lenses (Pitfall 5) | Scatterplot rendering phase | Add two lenses, remove one, count dots before/after |
| SlopeChart unit label wrong for GDP (Pitfall 6) | GDP panel architecture phase | Inspect axis label; must not read "million tonnes" in GDP panel |
| Blank panel between slope suppression and GDP scatter wiring (Pitfall 7) | Mode-dispatch + GDP scatter as one atomic commit | Toggle to per-capita with active lens; panel must show scatter, not blank |
| DOM key collision between slope and scatter (Pitfall 8) | GDP panel architecture phase | Toggle rapidly 10 times; inspect DOM for duplicate or orphaned groups |
| PPP qualifier missing from axis label (Pitfall 9) | GDP panel labeling phase | Read x-axis label text in the rendered SVG |

---

## Confidence Levels

| Area | Confidence | Basis |
|------|------------|-------|
| EXTRA_COLUMNS gap | HIGH | Read `config.ts` and `EmissionsDataset.load()` — pattern proven in v1.2 for per-capita columns |
| NaN propagation in GDP division | HIGH | Traced `EmissionsDataset.parse()` to NaN-on-empty; `Math.min/max` on NaN-containing arrays confirmed to return NaN |
| Stale slope DOM | HIGH | Read `CombinedChart.renderLenses()` and `SingleCountryChart.renderLenses()`; clear path only fires when `active === false` |
| Scatter domain across lenses | HIGH | D3 scaleLinear domain behavior on multiple data series is well-established; two-pass requirement follows from shared axis contract |
| Ghost dots from missing join keys | HIGH | D3 data-join behavior without key function causes accumulation — standard D3 pitfall with a known fix |
| SlopeChart unit label hardcoded | HIGH | Read `SlopeChart.renderScale()` line 405 — `'million tonnes'` is a string literal with no parameter |
| Mode-dispatch + GDP scatter timing | HIGH | Read `CombinedChart.renderLenses()` — the else branch produces a blank panel if GDP render is not yet wired |
| DOM group name collision | MEDIUM | Risk only if GDP renderer shares the SlopeChart SVG element; avoided by separate container |
| OWID GDP column as 2011 PPP | HIGH | OWID codebook documents `gdp` as "GDP in constant 2011 international-$ using purchasing power parity rates" |

---

*Pitfalls research for: ProjectLens v1.3 — GDP lens (mode-aware panel switch, nullable OWID data, multi-lens scatterplot)*
*Researched: 2026-06-20*
