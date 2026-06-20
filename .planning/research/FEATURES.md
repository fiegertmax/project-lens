# Feature Landscape: GDP Lens (v1.3)

**Domain:** GDP-contextualized lens effects on a per-capita CO₂ time-series visualization
**Researched:** 2026-06-20
**Confidence:** HIGH (codebase analysis + dataset inspection + climate data viz domain knowledge)

---

## Table Stakes

Features users expect. Missing = the panel feels broken or meaningless.

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Dual-metric slope panel (single-country per-capita + lens)** | Replaces the emptied slope slot that v1.2 clears in per-capita mode; without it, the slope area is a blank rectangle — visually confusing | Medium | `SlopeChart.render()` already exists; needs a new entry-builder that feeds `{leftValue, rightValue}` for GDP/cap and CO₂/cap instead of emission sources |
| **Scatterplot panel (multi-country per-capita + lens)** | Multi-country combined chart in per-capita mode has an empty slope slot; users who apply a lens expect to see something — a scatter of (GDP, CO₂) is the natural economic context panel for multi-country comparison | High | New chart component; reuses existing `StagedLensWindow` data model and stage color constants |
| **GDP/capita computed in-browser from `gdp ÷ population`** | Dataset has no `gdp_per_capita` column; both `gdp` and `population` are present from 1800+ for Germany; must be computed at render time | Low | Both columns already accessible via `RawPoint.extra` if added to `EXTRA_COLUMNS` in `config.ts`; one-line config change unlocks both |
| **X-axis labeled "GDP per capita (int-\$ PPP)"** | OWID GDP column is in constant 2011 international dollars PPP — labeling it as raw dollars or leaving it unlabeled misleads the reader | Low | Axis label string in the new scatterplot component |
| **Y-axis labeled "CO₂ per capita (t CO₂/person)"** | Consistent with the per-capita line chart unit already established in `metricSpec.ts`; must match exactly | Low | Reuse `metricSpec()` unit string |
| **Hover tooltip on scatter dots** | Individual dots are meaningless without country + year identification; missing tooltip = the chart is unreadable for more than 3 countries | Medium | D3 `mouseover`/`mouseout` on `<circle>` elements; same pattern as `CrosshairOverlay` but per-dot, not per-x-position |
| **Stage colors on scatter dots** | Each lens stage already has a color (`STAGE_COLORS`); dots from stage-1 lenses are green, stage-2 orange, stage-3 blue — mirrors the lens band colors the user already sees on the line chart | Low | `STAGE_COLORS` from `config.ts`; already imported everywhere |
| **"No data" guard when GDP or population is null** | Many countries have null GDP before ~1950; a dot with a computed NaN should be silently omitted, not rendered at (NaN, NaN) | Low | Filter dots where either axis value is non-finite before rendering |
| **Dual-metric slope: two distinct line colors** | With only two metrics (GDP/cap and CO₂/cap), they must be visually distinguishable at a glance; stage coloring alone is insufficient when both lines share the same stage color | Low | Assign a fixed palette pair: e.g. slate-blue for GDP/cap, the existing CO₂ per-capita color for CO₂/cap; encode in a new `GDP_SLOPE_METRICS` constant |
| **Slope y-scale unit annotation** | Current `SlopeChart.renderScale()` hardcodes "million tonnes"; dual-metric slope has two incompatible units — the scale must either be suppressed or show both units on separate axes | Medium | `SlopeChart` needs a mode flag or a new sibling class; the simplest route is a dedicated `GdpSlopeChart` that renders two independent y-axes (left = t CO₂/person, right = int-\$ PPP) |

---

## Differentiators

Features that meaningfully elevate the experience above the minimum viable panel.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Log scale option for GDP x-axis in scatterplot** | GDP per capita spans 2–3 orders of magnitude across visible countries (e.g. Germany ~\$50k vs India ~\$7k); a linear scale compresses poor countries into an unreadable cluster at the left edge. A log-scale x-axis is standard in every serious emissions-vs-GDP scatter (OWID, IEA, WRI). This alone makes the chart readable for mixed-income selections | Low | `scaleLog()` in D3 swaps in for `scaleLinear()`; needs a guard when any value ≤ 0 (GDP is always > 0 in valid data) |
| **Trend line / Environmental Kuznets Curve reference** | A simple quadratic or log-linear fit across all dots in the lens window gives users a visual anchor for the EKC hypothesis ("emissions rise, peak, then fall as GDP grows"). A dashed line overlay with no label is sufficient; no statistics required | High | Requires a least-squares fit across all country-year dot values in the current lens window; D3's `d3-regression` or a hand-rolled linear-log fit; medium algorithmic work |
| **Country labels on scatter dots (on hover, not always-on)** | In a multi-country view, dots cluster; always-on labels clutter immediately. Hover reveals the label next to the dot, aligned right or above to avoid overlap with the cursor | Low | `<text>` element appended/removed on `mouseover`; position clamped to SVG bounds |
| **Multiple lenses add dot sets in their stage colors** | Each additional lens window contributes its own dot set in the corresponding stage color (green/orange/blue) — identical to how slope lines are colored per stage. Users can compare the country's GDP/CO₂ position at three different time windows in one scatter | Low | Pass all active `StagedLensWindow[]` to the scatter component; outer loop over lenses, inner loop over countries |
| **Dual-metric slope: value labels at axis endpoints** | Show the actual GDP/cap and CO₂/cap values at each column endpoint in the slope chart — the same label-bumping logic `SlopeChart.bumpLabels()` already implements | Low | Reuse `bumpLabels()` from `SlopeChart`; the new `GdpSlopeChart` can call the same private-method pattern |
| **Per-country dot opacity proportional to data completeness** | Some countries have GDP data for only part of the lens window; a dot drawn from a single year's observation should be visually de-emphasized (50% opacity) vs a dot that represents a window-averaged value | Medium | Requires deciding whether dots represent individual years or window averages; see anti-features |

---

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **One dot per country (window average) in scatter** | Collapsing a lens window to a single average GDP and single average CO₂ per country loses the temporal story — you cannot see whether a country's relationship shifted within the window. Per-year dots preserve the time dimension and are consistent with the "boundary years" approach already used in the slope chart | Show one dot per country per year within the lens window; the stage color already communicates the time window |
| **Showing absolute (non-per-capita) GDP on scatter** | The absolute GDP axis conflates country size with prosperity; China's absolute GDP will always dwarf Denmark's. Per-capita normalization is the only defensible comparison | Always divide `gdp ÷ population`; never expose raw GDP total to the panel |
| **Reusing `SlopeChart` directly for dual-metric slope** | `SlopeChart` is tightly coupled to emission-source keys (`EMISSION_SOURCES`, `getSourceValue`, the "million tonnes" unit label) — force-fitting two metrics (GDP/cap + CO₂/cap) into those slots requires invasive changes that break the existing absolute-mode slope path | Create a focused `GdpSlopeChart` component that shares the layout (MARGIN, HEIGHT, axis helpers, `bumpLabels`) but uses its own entry-builder and dual-axis rendering |
| **Dual y-axis on the scatterplot** | A scatter plot already encodes two variables on X and Y; adding dual y-axes on a scatter is nonsensical and never done | Keep scatter as a standard X-Y plane |
| **GDP toggle separate from per-capita mode** | PROJECT.md explicitly marks "UC-03 GDP as a primary toggle" as out of scope; the GDP panel is lens-derived context only, not a standalone chart mode | Route all GDP context through the existing lens effect mechanism |
| **Recomputing GDP per capita via server or separate dataset** | Both `gdp` and `population` columns are in the OWID CSV already loaded in-browser; a second network fetch would double load time for no benefit | Compute `gdp / population` inline at render time from `RawPoint.extra` |
| **Animated transitions between dot positions** | Per-year dot clouds can contain 100+ dots when multiple countries × large lens windows are selected; animating all of them risks jank and offers little insight compared to the static scatter layout | Render dots statically; rely on stage color + hover tooltip to reveal temporal structure |
| **Regression line on slope chart** | A regression over just two or four boundary-year values is statistically meaningless; the two-point or four-point slope already communicates direction clearly | Reserve regression for the scatterplot only (and even there it is a differentiator, not table stakes) |
| **Per-capita toggle disabled when lens is active** | Forcing the user to remove lenses before switching modes degrades UX and is technically unnecessary — the mode-switch simply triggers a slope-panel swap | Let the mode toggle fire freely; `renderLenses()` in both chart classes already re-routes to the correct panel type on every state change |

---

## Feature Dependencies

```
gdp and population added to EXTRA_COLUMNS (config.ts)  [ONE-LINE CHANGE]
  → EmissionsDataset carries columns through RawPoint.extra
  → All derived GDP/cap computations read from point.extra['gdp'] / point.extra['population']

metricMode === 'per-capita' check in renderLenses()  [ALREADY EXISTS in CombinedChart + SingleCountryChart]
  → Single-country per-capita + lens  →  GdpSlopeChart.render()  [NEW]
  → Combined per-capita + lens        →  ScatterPanel.render()    [NEW]
  → Absolute mode (any chart)         →  existing SlopeChart path (unchanged)

GdpSlopeChart  [NEW COMPONENT]
  → Shares MARGIN, HEIGHT, bumpLabels pattern with SlopeChart
  → Builds two MetricEntry rows: { key: 'gdp_per_capita', label: 'GDP/cap', ... } and { key: 'co2_per_capita', label: 'CO₂/cap', ... }
  → Renders left y-axis (CO₂/cap, t/person) + right y-axis (GDP/cap, int-$)
  → Reads values from RawPoint.extra at boundary years (same lookup pattern as getSourceValue)

ScatterPanel  [NEW COMPONENT]
  → Receives: countries[], StagedLensWindow[], dataset, yearRange
  → For each lens × each country × each year in [startYear, endYear]:
      - x = point.extra['gdp'] / point.extra['population']
      - y = point.extra['co2_including_luc_per_capita']  (already in EXTRA_COLUMNS)
      - color = STAGE_COLORS[lens.stage]
  → Renders <circle> per dot, tooltip on mouseover
  → X-axis: log scale (GDP/cap), labeled "GDP per capita (int-$ PPP)"
  → Y-axis: linear (CO₂/cap), labeled "CO₂ per capita (t/person)"

StagedLensWindow[]  [ALREADY EXISTS — slope-types.ts]
  → Feeds ScatterPanel with stage + startYear + endYear
  → No change needed to the lens data model
```

---

## Null / Zero Data Handling

Dataset inspection:
- `gdp`: non-null from 1820 for Germany; null for many developing countries before 1950–1960
- `population`: non-null from 1800 for Germany; rarely null post-1950 for any sovereign state
- `co2_including_luc_per_capita`: already handled by existing v1.2 logic

The default year range is 1950–2024. For the scatterplot, a dot is silently skipped when either `gdp / population` or `co2_including_luc_per_capita` is NaN. No user-visible error state is needed — sparse data simply produces fewer dots, which is self-explanatory.

For the dual-metric slope chart, a boundary-year observation with null GDP but valid CO₂/cap should still draw the CO₂/cap line; only the GDP/cap line is omitted at that column. The existing `undefined` handling in `SlopeChart.renderStageLines()` already provides this behavior and can be reused.

---

## Scale Decision: Log vs Linear for GDP Axis

**Recommendation: log scale on the scatter X-axis, with a clear axis note.**

Rationale: Germany's GDP/cap (~\$50k int-\$), India's (~\$7k), and China's (~\$18k) span nearly one order of magnitude. A linear X compresses the developing-country cluster into ~14% of the axis width, making per-country variation invisible. Log scale is the standard treatment in every published GDP-vs-emissions scatter (OWID, IEA, WRI publications). The EKC relationship is also typically plotted on a log-linear or log-log axis. In D3, swapping `scaleLinear` for `scaleLog` is a one-line change; axis tick formatting with `d3.format('$,.0f')` produces readable labels at standard log intervals.

D3 `scaleLog` requires all input values > 0. GDP/capita from the OWID dataset is always positive for countries with real data; the null-guard (skip NaN dots) already excludes zero-GDP rows.

**For the dual-metric slope chart:** Use two independent linear y-axes (left = CO₂/cap in t/person, right = GDP/cap in k int-\$). Linear is appropriate because the slope chart shows values at only 2–4 discrete years — the relative ordering of the two metrics at each year is what matters, not the full distribution. Log scale on a two-point slope line would misrepresent the proportional change.

---

## Tooltip Format Recommendations

**Scatterplot dot hover:**
```
[Country] — [Year]
GDP/cap: $X,XXX int-$ PPP
CO₂/cap: X.XX t/person
```

**Dual-metric slope endpoint:**
No separate tooltip needed — existing label-bumping places the value next to each endpoint.

**GDP value formatting:**
Use `d3.format('$,.0f')` for absolute values under $100k (e.g. `$53,110`), or `d3.format('$,.0~s')` for SI-prefix compact format (e.g. `$53.1k`). Compact format is preferred for axis tick labels; full format for tooltip.

---

## MVP Recommendation

Implement in this order (each step unblocks the next):

1. **Add `gdp` and `population` to `EXTRA_COLUMNS`** in `config.ts` — one-line change; unlocks all downstream GDP computation without any architectural change
2. **`GdpSlopeChart` component** — single-country per-capita lens path; reads CO₂/cap (already in EXTRA_COLUMNS) and computes GDP/cap from extra columns at boundary years; draws two lines with distinct colors; left/right y-axes with distinct units
3. **Wire `SingleCountryChart.renderSlope()` to route to `GdpSlopeChart`** when `metricMode === 'per-capita'`
4. **`ScatterPanel` component** — multi-country per-capita lens path; log X-axis, linear Y-axis; one dot per country-year per lens stage; hover tooltip
5. **Wire `CombinedChart.renderLenses()` to route to `ScatterPanel`** when `metricMode === 'per-capita'`

Defer:
- Log-scale toggle (UI control): render log by default; toggle can be added in a polish pass
- Trend line / EKC reference curve: algorithmic complexity is non-trivial; skip for MVP

---

## Sources

- Codebase analysis: `src/charts/SlopeChart.ts`, `src/charts/SingleCountryChart.ts`, `src/charts/CombinedChart.ts`, `src/utils/metricSpec.ts`, `src/config.ts`, `src/state/AppState.ts`, `src/state/CountryLensState.ts`, `src/charts/slope-types.ts`, `src/data/types.ts`
- Dataset inspection: `public/data/owid-co2-data.csv` — Python analysis of GDP/population column availability, null coverage, and unit verification (US 2020 GDP/cap ~$53k int-$ 2011 PPP)
- Project context: `.planning/PROJECT.md` — v1.3 milestone goals, explicit out-of-scope items
- Prior research: `.planning/research/FEATURES.md` — v1.2 per-capita feature landscape (reused null-data analysis and EXTRA_COLUMNS pattern)
