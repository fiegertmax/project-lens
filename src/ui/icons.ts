/** Shared inline SVGs; they paint with currentColor so CSS controls the colour. */

/** Magnifying-glass lens — reused by the apply button, the drag ghost, and the staged sidebar icons (LensStagePanel). Stage colour is applied via CSS `.lens-stage-icon--stage-N`; no per-stage SVG copy is needed. */
export const LENS_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
  <line x1="15.2" y1="15.2" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/** Globe glyph for the "quick select on a world map" button. */
export const GLOBE_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
  <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="2"/>
  <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" stroke-width="2"/>
  <line x1="4.5" y1="7" x2="19.5" y2="7" stroke="currentColor" stroke-width="2"/>
  <line x1="4.5" y1="17" x2="19.5" y2="17" stroke="currentColor" stroke-width="2"/>
</svg>`;

/** Circled "i" help glyph for the info tip. */
export const INFO_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
  <circle cx="12" cy="8" r="1.1" fill="currentColor"/>
  <line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;
