# ProjectLens — "Magic Lenses"

An interactive D3.js visualization for exploring global CO₂ emission trends, built with
TypeScript and Vite for an Interactive Information Visualization course.

## Purpose

ProjectLens turns the [Our World in Data CO₂ dataset](https://github.com/owid/co2-data)
into an explorable line chart of yearly carbon emissions per country. Rather than cramming
every detail onto one busy chart, it keeps the base view clean and lets users hover a
**ChronoLens** over any time window to reveal deeper, derived insights on demand.

## Core feature: the ChronoLens

Drag a lens from the sidebar onto a country's line chart to highlight a time span and
inspect what happened inside it — **without altering the base chart**. Lenses are revealed
in three progressive stages, each surfacing a different derived view:

- **Source breakdown** — a slope chart showing how each emission source (coal, oil, gas,
  cement, flaring, land use, …) changed between the start and end of the window
- **Rate of change** — annual growth across the window
- **Emissions vs. wealth** — CO₂ per capita against GDP per capita

Lenses can be placed independently per chart, or linked across charts (hold Shift) so they
move together for side-by-side comparison.

## Ways to explore

- **Pick countries** via checkboxes, a search bar, or an interactive world map
- **Set the time span** with a year-range slider
- **Switch the metric** between absolute emissions and per-capita, and include or exclude
  land-use-change (LUC) emissions
- **Split the view** by dragging a country out into its own row chart for focused comparison
- **Ask why** — on the absolute-emissions view, an AI research panel uses web search to
  explain the real-world causes (policies, plant closures, economic shifts) behind a
  country's emission changes over a chosen period

## Data

- Source: [owid/co2-data](https://github.com/owid/co2-data)
- Base measure: annual CO₂ emissions (million tonnes), with auxiliary columns (population,
  GDP, per-source breakdown) read directly from the dataset for lens effects

## Running locally

```bash
npm install
npm run dev      # start the Vite dev server
npm run build    # type-check and produce a production build
```
