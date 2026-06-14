import { CO2_SOURCES } from '../config';
import { Collapsible } from './Collapsible';

const GLOBAL_STEPS: [string, string][] = [
  [
    'Hover over "Other ‹continent›"',
    'A mini-diagram pops up showing every country that was too small to label individually in the main chart.',
  ],
  [
    'Countries in "Other"',
    'Only the top emitters wide enough to carry a label appear as their own bar. All remaining countries of that continent are always accessible via the hover lens.',
  ],
  [
    'Focus a continent',
    'Use the continent focus toggle in the Base Visualization panel to zoom the Sankey into a single continent and see every country individually — no "Other" grouping.',
  ],
];

/** Collapsible "Lens" info panel for the global Sankey visualization.
 *  Call update(isFocused) whenever the mode changes to show the right content. */
export class SankeyLensPanel {
  readonly root: HTMLDivElement;
  private readonly globalSection: HTMLElement;
  private readonly focusedSection: HTMLElement;

  constructor(parent: HTMLElement) {
    const panel = new Collapsible(parent, 'Lens', 'sankey-lens-panel');
    this.root = panel.root;

    // --- Global mode section ---
    this.globalSection = document.createElement('section');
    const globalList = document.createElement('dl');
    globalList.className = 'sankey-lens-panel__list';
    for (const [term, desc] of GLOBAL_STEPS) {
      const dt = document.createElement('dt');
      dt.className = 'sankey-lens-panel__term';
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.className = 'sankey-lens-panel__desc';
      dd.textContent = desc;
      globalList.append(dt, dd);
    }
    this.globalSection.appendChild(globalList);

    // --- Focused mode section ---
    this.focusedSection = document.createElement('section');
    const intro = document.createElement('p');
    intro.className = 'sankey-lens-panel__desc';
    intro.textContent =
      'Hover over any country bar to see how its emissions break down by source.';
    this.focusedSection.appendChild(intro);

    const sourceList = document.createElement('dl');
    sourceList.className = 'sankey-lens-panel__sources';
    for (const { label, description, color } of CO2_SOURCES) {
      const dt = document.createElement('dt');
      dt.className = 'sankey-lens-panel__source-term';
      const dot = document.createElement('span');
      dot.className = 'sankey-lens-panel__source-dot';
      dot.style.background = color;
      dt.append(dot, label);

      const dd = document.createElement('dd');
      dd.className = 'sankey-lens-panel__source-desc';
      dd.textContent = description;

      sourceList.append(dt, dd);
    }
    this.focusedSection.appendChild(sourceList);

    panel.body.append(this.globalSection, this.focusedSection);
    this.update(false);
  }

  /** Switch panel content between global-mode guide and focused-mode source glossary. */
  update(isFocused: boolean): void {
    this.globalSection.style.display = isFocused ? 'none' : '';
    this.focusedSection.style.display = isFocused ? '' : 'none';
  }
}
