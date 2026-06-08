/** A titled section whose body can be minimized to free up space. */
export class Collapsible {
  readonly root: HTMLDivElement;
  readonly body: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private collapsed = false;

  constructor(parent: HTMLElement, title: string, className = '') {
    this.root = document.createElement('div');
    this.root.className = ['collapsible', className].filter(Boolean).join(' ');

    const header = document.createElement('div');
    header.className = 'collapsible__header';

    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.toggle.className = 'collapsible__toggle';
    this.toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed));

    const label = document.createElement('span');
    label.className = 'collapsible__title';
    label.textContent = title;

    header.append(this.toggle, label);

    this.body = document.createElement('div');
    this.body.className = 'collapsible__body';

    this.root.append(header, this.body);
    parent.appendChild(this.root);
    this.syncToggle();
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
