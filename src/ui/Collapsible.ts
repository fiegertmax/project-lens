/** A titled section whose body can be minimized to free up space. */
export class Collapsible {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly headerEl: HTMLDivElement;
  private collapsed = true;

  constructor(parent: HTMLElement, title: string, className = '') {
    this.root = document.createElement('div');
    this.root.className = ['collapsible', className].filter(Boolean).join(' ');

    this.headerEl = document.createElement('div');
    const header = this.headerEl;
    header.className = 'collapsible__header';

    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'collapsible__toggle';
    this.toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed));

    const label = document.createElement('span');
    label.className = 'collapsible__title';
    label.textContent = title;

    header.addEventListener('dblclick', (e) => {
      // Only trigger if not clicking the toggle button itself (it handles single click)
      if (e.target !== this.toggle) this.setCollapsed(!this.collapsed);
    });

    header.append(this.toggle, label);

    this.body = document.createElement('div');
    this.body.className = 'collapsible__body';

    this.root.append(header, this.body);
    parent.appendChild(this.root);
    this.setCollapsed(this.collapsed);
  }

  /** Append extra content (e.g. an icon button) to the right of the header title. */
  appendToHeader(el: HTMLElement): void {
    this.headerEl.appendChild(el);
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.root.classList.toggle('collapsible--collapsed', collapsed);
    this.syncToggle();
  }

  private syncToggle(): void {
    this.toggle.textContent = this.collapsed ? '+' : '−';
    this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
  }
}
