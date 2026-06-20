# Project Research Summary

**Project:** ProjectLens v1.3 — GDP Lens
**Domain:** Interactive D3.js visualization with magic-lens overlay system
**Researched:** 2026-06-20
**Confidence:** HIGH

## Executive Summary

ProjectLens v1.3 adds GDP-contextualized lens effects to the existing per-capita CO₂ visualization. When users enable per-capita mode and place a magic lens, the chart switches from showing emission source breakdowns to showing two new economic context panels: a dual-metric slope chart (for single-country view) and a scatterplot (for multi-country view). Both panels display the relationship between GDP per capita and CO₂ per capita within the lens window, enabling users to analyze whether emissions rise or fall with economic development.

The research confirms this is achievable with **zero new npm dependencies**. All required D3.js functions are already bundled in `d3@7.9.0`. The only data layer change needed is adding two columns (`gdp` and `population`) to `EXTRA_COLUMNS` in `config.ts` — a one-line addition. The dataset already carries these columns; they just need to be retained through the data indexing process. The GDP per capita value is derived in-browser as `gdp / population` at render time, matching existing patterns used for other computed metrics.

**Key risk:** The integration requires careful mode-aware dispatch and nullable data handling. Developers must add the EXTRA_COLUMNS entries before writing any GDP computation code, and must guard all division operations against NaN/Infinity propagation. The existing slope chart must not be reused for GDP rendering — a new standalone component is needed to avoid hardcoded unit labels ("million tonnes") that would be wrong for GDP. When switching between absolute and per-capita modes, the old panel must be completely cleared before the new one renders, and dots from removed lenses must not accumulate in the DOM.

## Key Findings

### Recommended Stack

The v1.3 milestone requires **no new npm dependencies**. Every D3.js function needed for the GDP lens is already available in the installed `d3@7.9.0` package:

**Core technologies (no changes):**
- **D3 v7.9.0** — `scaleLinear`, `scaleLog` (for optional log x-axis), `axisLeft`, `axisRight`, `axisBottom`, `format`, `extent`, `max` already imported across chart classes
- **TypeScript** — strictly typed for component boundaries and data contracts
- **Vite** — existing build chain handles all new TypeScript files

**New derivation patterns (added to existing dataset):**
- `gdp` and `population` columns added to `EXTRA_COLUMNS` in `config.ts`
- `gdp_per_capita` computed in-browser as `gdp / population` at render time (matches existing `getSourceValue` pattern)
- All nullable data guarded with `Number.isFinite()` checks before scale domain building

### Expected Features

**Must have (table stakes):**
- **Dual-metric slope panel (single-country per-capita + lens)** — Currently v1.2 suppresses the slope chart entirely in per-capita mode, leaving a blank rectangle. The GDP slope must fill this slot showing two lines: GDP per capita and CO₂ per capita at lens boundary years, with distinct colors and independent y-axes (USD and tonnes).
- **Scatterplot panel (multi-country per-capita + lens)** — Multi-country per-capita view has no lens context; a scatter of (GDP, CO₂) points per country-year is the natural economic comparison. One dot per country-year per lens stage, colored by stage (`STAGE_COLORS`).
- **GDP/capita derived in-browser** — Dataset has `gdp` and `population` columns; derive `gdp / population` at render time. No pre-computed column exists in OWID.
- **Proper axis labeling** — X: "GDP per capita (2011 int-$ PPP)" (accounting for OWID's purchasing power parity adjustment), Y: "CO₂ per capita (t CO₂/person)"
- **Hover tooltip on scatter dots** — Individual dots are uninterpretable without country + year identification
- **Stage colors on scatter dots** — Match the lens band colors users already see on the line chart (`STAGE_COLORS`)
- **Null data guards** — Skip dots when either `gdp/population` or `co2_per_capita` is non-finite

**Should have (competitive differentiators):**
- **Log scale option for GDP x-axis** — GDP spans 2–3 orders of magnitude (Germany ~$50k, India ~$7k); linear scale compresses developing countries into unreadable clusters. Log scale is standard in published GDP-vs-emissions scatters.
- **Multiple lenses accumulate dots in one scatter** — Each additional lens adds its own dot set in the corresponding stage color, allowing temporal comparison across three time windows simultaneously
- **Value labels at dual-metric slope endpoints** — Show actual GDP/cap and CO₂/cap values at each boundary year (reuse existing `bumpLabels()` logic from `SlopeChart`)
- **Country labels on scatter dots (hover)** — Reveal country name next to dot on mouseover to disambiguate clustered points

**Defer (v2+):**
- Trend line / Environmental Kuznets Curve reference fit (algorithmic complexity)
- Per-country dot opacity weighted by data completeness
- Animated transitions between dot positions

### Architecture Approach

The v1.3 integration reuses the existing lens state machine and mode dispatcher. No new `AppState` subscribers are needed — the existing `CombinedChart.renderLenses()` and `SingleCountryChart.renderLenses()` methods already contain MetricMode guards that suppress the slope chart in per-capita mode. Those guards are extended to dispatch to new GDP rendering methods instead of clearing the panel completely.

**Major components (new or modified):**
1. **Data layer** — Add `'gdp'` and `'population'` to `EXTRA_COLUMNS`; create `getGdpPerCapita()` utility (one-line math with NaN guard)
2. **SlopeChart modification** — Export `SourceEntry` interface; add public `renderEntries()` overload to accept pre-built entries for the single-country dual-metric slope path
3. **GdpSlopeChart new class** — Standalone component for single-country per-capita mode; renders two independent y-axes and lines for GDP/cap and CO₂/cap with distinct stroke styles
4. **GdpScatterPanel new class** — Multi-country scatterplot (XY plane, GDP vs CO₂, one dot per country-year per lens); manages shared axis domains across all active lenses
5. **SingleCountryChart modification** — Branch `renderSlope()` on `metricMode`: 'absolute' → existing source breakdown, 'per-capita' → GDP slope. Requires either injecting `AppState` or receiving `metricMode` as a parameter.
6. **CombinedChart modification** — Branch `renderLenses()` on `metricMode`: 'absolute' → existing slope aggregate, 'per-capita' → GDP scatter. Instantiate and manage `GdpScatterPanel` alongside `SlopeChart`.

### Critical Pitfalls

1. **EXTRA_COLUMNS gap (Pitfall 1)** — If `'gdp'` and `'population'` are not added to `EXTRA_COLUMNS` before any rendering code is written, both columns remain absent from `point.extra` and every GDP calculation silently returns `undefined`. The scatterplot appears empty with no error. **Prevention:** Add columns in the first commit; verify in console: `dataset.series('Germany')?.points.find(p => p.year === 2000)?.extra['gdp']` must return a finite number.

2. **NaN/Infinity propagation in GDP division (Pitfall 2)** — When `population` is 0 or `NaN`, the division `gdp / population` produces `Infinity` or `NaN`. These poison D3 scale domains, causing all dots to render at (0, 0) or off-screen. **Prevention:** Compute GDP per capita in a helper returning `undefined` on any non-finite operand; guard all domain builders with `Number.isFinite()` checks before accumulating values.

3. **Stale slope DOM after mode switch (Pitfall 3)** — When switching from absolute to per-capita mode with an active lens, the existing slope chart lines are not cleared before the GDP panel renders. Old source breakdowns remain visible under new content. **Prevention:** Call `slopeChart.clear()` synchronously before scheduling GDP render via `requestAnimationFrame`; or keep slope and GDP panels in separate DOM containers, toggling visibility instead of share-and-clear.

4. **Scatter domain collapse/overflow with multiple lenses (Pitfall 4)** — If the scatter domain is computed per-lens and axes are re-rendered on each iteration, the second lens re-scales and clips dots from the first. **Prevention:** Collect all points from all lenses first; compute union domain; build shared scales once; then render each lens's dots using those fixed scales.

5. **Ghost dots from removed lenses (Pitfall 5)** — D3 circles appended without a keyed `.join()` accumulate and never disappear when a lens is removed. **Prevention:** Use `.join()` with a `lensId-country-year` key function; re-render the entire scatter (not per-lens in separate loops) on every lens state change.

## Implications for Roadmap

Based on research, the v1.3 feature decomposes into five sequential phases, each addressing specific integration points and avoiding a class of pitfalls:

### Phase 1: Data Layer (EXTRA_COLUMNS + getGdpPerCapita)

**Rationale:** Unlocks all downstream GDP computation without any visual change. Must be done first because every subsequent phase depends on these columns being available in `point.extra`.

**Delivers:**
- `'gdp'` and `'population'` added to `EXTRA_COLUMNS` in `config.ts`
- New `src/utils/getGdpPerCapita.ts` helper returning `number | undefined` with NaN guards
- `npm run build` passes; no visual change yet

**Avoids:** Pitfalls 1 & 2 (missing columns, NaN propagation)

**Research flag:** None — standard data layer work. No deeper research needed.

### Phase 2: SingleCountryChart Per-Capita Slope (GDP Dual-Metric)

**Rationale:** Isolated, non-visual work to export the `SourceEntry` interface and add the `renderEntries()` overload to `SlopeChart`. This unblocks the single-country per-capita visualization without touching `CombinedChart` yet.

**Delivers:**
- Export `SourceEntry` interface from `SlopeChart`
- Add public `renderEntries(lenses, allEntries, yDomain?)` method to `SlopeChart`
- In `SingleCountryChart.renderSlope()`, branch on `metricMode`: absolute → existing path, per-capita → build two-entry array `[{gdp_per_capita}, {co2_per_capita}]` and call `slopeChart.renderEntries()`
- Two distinct stroke styles per metric (solid for CO₂, dashed for GDP) or separate lines with explicit colors
- Resolve MetricMode access in `SingleCountryChart`: recommend injecting `AppState` in constructor (Option A from ARCHITECTURE.md)

**Avoids:** Pitfall 3 (stale DOM) via clearing slope before rendering GDP content

**Research flag:** **Yes** — Phase 2 needs deeper research on **dual y-axis strategy** for the GDP slope. Decision needed before implementation: (a) normalize both metrics to [0, 1] to share a single y-axis, (b) use two independent left/right y-axes, or (c) show metrics on separate stacked SlopeChart instances. Decision impacts component API and rendering logic.

### Phase 3: GdpScatterPanel Component (Multi-Country Scatter)

**Rationale:** Build the new panel class in isolation before wiring it to `CombinedChart`. Allows testing data-to-SVG mapping independently of the mode dispatcher.

**Delivers:**
- New `src/charts/GdpScatterPanel.ts` class with API: `constructor(parent)`, `renderMultiCountry(countries, lenses, dataset)`, `clear()`, `destroy()`, `node()`
- D3 scatterplot: one circle per (country, year) per lens in the window `[lens.startYear, lens.endYear]`
- X-axis: GDP per capita (recommend log scale with `scaleLog()`); Y-axis: CO₂ per capita (linear)
- Dots colored by `STAGE_COLORS[lens.stage]`
- Domain collection via two-pass approach: collect all points from all lenses, compute shared domain, render with fixed scales
- Keyed D3 join with `lensId-country-year` keys to prevent dot accumulation on lens removal
- Hover tooltip: country, year, values

**Avoids:** Pitfalls 4 & 5 (domain collapse, ghost dots)

**Research flag:** None — D3 scatterplot is a standard pattern. Recommend log scale by default based on FEATURES.md research.

### Phase 4: CombinedChart Mode Dispatcher + GdpScatterPanel Wiring

**Rationale:** Connect the GDP scatter to the existing mode system. This is where the lens interaction becomes visible in multi-country view.

**Delivers:**
- Modify `CombinedChart.renderLenses()` to dispatch: absolute mode → `renderSlope()`, per-capita + active lenses → `renderGdpView()`, no lenses → clear both
- Add `CombinedChart.renderGdpView(lenses)` private method
- Instantiate `GdpScatterPanel` in `CombinedChart` constructor; mount in `slopeCell` container
- Toggle visibility: `display: none` for slope in per-capita mode, `display: none` for scatter in absolute mode
- Hide weighted-mean toggle when `metricMode === 'per-capita'` (meaningless for per-country dots)

**Avoids:** Pitfall 7 (blank panel between slope suppression and scatter wiring) by implementing mode dispatch and scatter render as one atomic commit

**Research flag:** None — existing dispatcher pattern confirmed in source; integration is straightforward.

### Phase 5: Polish & Axis Labels

**Rationale:** Final pass on user-facing text, tooltips, and unit annotations. Ensures the visualization tells the right story about the data.

**Delivers:**
- Axis labels on `GdpScatterPanel`: X: "GDP per capita (2011 int-$ PPP)", Y: "CO₂ per capita (t CO₂/person)"
- Dual-metric slope y-axis annotations or labels for both metrics
- Tooltip polish: format GDP values as `$X,XXX` or `$X.Xk` (use `d3.format('$,.0~s')`), CO₂ as `X.XX t/person`
- "No data" notice when selected countries have sparse GDP data (optional, defer if time-constrained)
- Verify stage colors match exactly: green `#2e9e5b`, orange `#e08a2e`, blue `#3b73c8`

**Avoids:** Pitfall 9 (misleading PPP label)

**Research flag:** None — labeling and formatting are straightforward. Confirm OWID GDP units with domain expert before final demo.

### Phase Ordering Rationale

1. **Data layer first** ensures that all dependent code has access to the required columns. Without it, every downstream phase silently fails.
2. **Single-country slope second** because it is isolated (affects only one chart class) and unblocks confidence that the mode dispatcher works correctly before the more complex multi-country scatter is built.
3. **Scatter component third** as a standalone module, decoupled from `CombinedChart`. This allows easier testing and debugging.
4. **Dispatcher fourth** wires all pieces together and is the phase most likely to have integration surprises. By that point, both target panels exist and can be tested.
5. **Polish last** because it does not unblock any other work; it only refines the UI and messaging.

This ordering also minimizes the risk of the "looks done but isn't" state where mode switching works but the GDP panel is blank — that state is avoided by Phase 4 being a single atomic commit.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Dual y-axis strategy for the GDP slope chart (normalized scale vs. independent axes vs. stacked panels). This architectural decision affects the component API and must be made before implementation begins.

Phases with standard patterns (can skip research-phase):
- **Phase 1:** Standard data column addition; pattern established by v1.2 per-capita research
- **Phase 3:** D3 scatterplot is a core primitive; pattern confirmed in STACK.md
- **Phase 4:** Dispatcher pattern already exists in codebase; integration is mechanical
- **Phase 5:** Formatting and labeling are straightforward; no domain unknowns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All D3 functions confirmed present in `d3@7.9.0`. No new npm dependencies. EXTRA_COLUMNS pattern proven in v1.2. |
| Features | HIGH | Codebase analysis + dataset inspection. Feature scope derived from project constraints in PROJECT.md. Table-stakes features have clear dependencies. |
| Architecture | HIGH | Full codebase read; all integration points (renderLenses, mode dispatch, SlopeChart API) confirmed from source. Component boundaries are clear. |
| Pitfalls | HIGH | Every pitfall traced to specific source code locations. NaN propagation, DOM accumulation, and unit label conflicts have documented precedents in existing code. |

**Overall confidence:** HIGH

### Gaps to Address

1. **Dual y-axis strategy for Phase 2** — ARCHITECTURE.md documents three options (normalized, independent, stacked) but does not pick one. Recommend injecting this as a `/gsd-plan-phase --research-phase 2` task to validate with a domain expert or quick prototype before implementation.

2. **Log vs. linear scale toggle persistence** — FEATURES.md recommends log scale by default but defers a UI toggle to v2+. Confirm with stakeholders whether the MVP should render log-only (simpler, recommended) or include a toggle UI element.

3. **Environmental Kuznets Curve reference line** — Listed as a differentiator (deferred). If time allows, revisit during Phase 3 or 4 to see if a simple linear regression is worth the algorithmic effort.

4. **Performance at scale** — No performance testing done yet. Phase 3 should profile scatter rendering with 50+ countries and 40-year lens windows to verify O(n) dot collection is acceptable. (Expected to be fine based on codebase patterns, but not measured.)

## Sources

### Primary (HIGH confidence)
- **STACK.md** — Comprehensive D3 v7 API audit; all required functions confirmed already imported; zero new dependencies
- **FEATURES.md** — Feature landscape derived from codebase analysis and OWID dataset inspection; must-have vs. differentiator framing based on v1.2 precedent
- **ARCHITECTURE.md** — Full read of 46 TypeScript files; dispatch points identified; component boundaries clarified; build order derived from dependency analysis
- **PITFALLS.md** — 9 critical/moderate pitfalls identified with prevention strategies; traced to source code locations; confidence levels per pitfall

### Secondary (MEDIUM confidence)
- **PROJECT.md** — v1.3 milestone scope and out-of-scope items (GDP is a lens effect, not a standalone toggle)
- **CLAUDE.md** — Project conventions enforced (OCP principle, build constraint, strong typing)
- **OWID CSV header inspection** — GDP column confirmed present; per-capita formula verified against Germany 2020 data (44,754 USD/person, matches World Bank)

### Tertiary (LOW confidence)
- **Visual design for scatter colors and tooltips** — Recommend validation with UX reviewer during Phase 3–4

---

*Research completed: 2026-06-20*
*Ready for roadmap: yes*
*Next step: Run `/gsd-plan-phase --research-phase 2` to validate dual y-axis strategy, then proceed to requirements definition*
