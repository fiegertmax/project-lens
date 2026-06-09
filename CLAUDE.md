# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

ProjectLens ("Magic Lenses") is a D3.js visualization built with TypeScript and Vite, created for an Interactive Information Visualization course.

**Concept**
- Base visualization: a line chart of yearly carbon emissions per country (time-series data)
- Users select countries via checkboxes, find them via a search bar, and configure the displayed time span
- "ChronoLens": a magic lens hovered over the line chart(s) that reveals configurable derived insights (e.g. rate of change, emissions relative to population) without altering the underlying base visualization

## Project status

The repository currently contains only planning docs (README.md, project-description.md). No Vite/TypeScript scaffold, package.json, or source code exists yet — set this up following the conventions below before/while starting implementation.

## Tech stack & conventions

- **D3.js** for visualization, **TypeScript** for all source code, **Vite** as build tool/dev server
- Use single quotes for all TypeScript strings
- Favor strongly-typed classes over loose objects/`any` — model domain concepts (e.g. an emissions series, a lens, a chart) as classes/interfaces with explicit types
- Apply the open/closed principle: extend behavior (new lens types, new chart layers) by adding new classes/strategies rather than editing existing ones
- Separate concerns cleanly: data loading/parsing, visualization rendering, and interaction/UI logic belong in distinct modules, not mixed within one class or file
- Keep methods brief, single-purpose, and easy to read at a glance
- Apply established design patterns where they genuinely fit (e.g. strategy for interchangeable lens computations, observer for selection/filter state, factory for chart construction) — don't force a pattern where a simple function suffices
- For each feature request, try to find the best possible solution
- If you are uncertain, perform web research on the problem

## Documentation style

- Keep comments and docs short; explain *why*, not *what*
- Avoid long prose about specific areas of the code

## Scripting

- after implementation, always run 'npm run build' in order to verify the project builds - never mark a task as finished when the project does not build
- if you ever start the project, ensure you shut it down properly afterwards - ensure I never get an error on startup because the port is taken

## Implementation rationale

- when prompted to adjust the visualization in any way that introduces a new variable, always check if the variable is available in the dataset in order to potentially minimize own calculations