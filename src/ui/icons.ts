/** Shared inline SVGs; they paint with currentColor so CSS controls the colour. */

/** Magnifying-glass lens — reused by the apply button and the drag ghost. */
export const LENS_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/>
  <line x1="15.2" y1="15.2" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/** Circled "i" help glyph for the info tip. */
export const INFO_ICON = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
  <circle cx="12" cy="8" r="1.1" fill="currentColor"/>
  <line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;
