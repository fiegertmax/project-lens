import { Collapsible } from './Collapsible';

const STEPS: [string, string][] = [
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

/** Collapsible "Lens" info panel for the global Sankey visualization. */
export class SankeyLensPanel {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    const panel = new Collapsible(parent, 'Lens', 'sankey-lens-panel');
    this.root = panel.root;

    const list = document.createElement('dl');
    list.className = 'sankey-lens-panel__list';

    for (const [term, desc] of STEPS) {
      const dt = document.createElement('dt');
      dt.className = 'sankey-lens-panel__term';
      dt.textContent = term;

      const dd = document.createElement('dd');
      dd.className = 'sankey-lens-panel__desc';
      dd.textContent = desc;

      list.append(dt, dd);
    }

    panel.body.appendChild(list);
  }
}
