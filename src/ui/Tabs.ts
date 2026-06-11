/** A tab's label and its content, built once and shown/hidden on switch. */
export interface TabDefinition {
  id: string;
  label: string;
  render(body: HTMLElement): void;
}

/** Generic tab strip: builds every panel eagerly so child component state
 *  (search fields, scroll position, ...) survives switching tabs. */
export class Tabs {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly panels = new Map<string, HTMLDivElement>();

  constructor(
    parent: HTMLElement,
    tabs: readonly TabDefinition[],
    initialId: string,
    onChange: (id: string) => void,
  ) {
    const header = document.createElement('div');
    header.className = 'tabs__header';

    const panelGroup = document.createElement('div');
    panelGroup.className = 'tabs__panels';

    for (const tab of tabs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tabs__button';
      button.textContent = tab.label;
      button.addEventListener('click', () => {
        this.setActive(tab.id);
        onChange(tab.id);
      });
      header.appendChild(button);
      this.buttons.set(tab.id, button);

      const panel = document.createElement('div');
      panel.className = 'tabs__panel';
      tab.render(panel);
      panelGroup.appendChild(panel);
      this.panels.set(tab.id, panel);
    }

    parent.append(header, panelGroup);
    this.setActive(initialId);
  }

  private setActive(id: string): void {
    for (const [tabId, button] of this.buttons)
      button.classList.toggle('tabs__button--active', tabId === id);
    for (const [tabId, panel] of this.panels)
      panel.classList.toggle('tabs__panel--hidden', tabId !== id);
  }
}
