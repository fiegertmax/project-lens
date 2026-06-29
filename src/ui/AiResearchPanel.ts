import type { EmissionsDataset } from '../data/EmissionsDataset';
import type { AiResearchState } from '../state/AiResearchState';
import { TrendResearchClient } from '../ai/TrendResearchClient';
import { buildTrendContext } from '../ai/trendContext';
import type { TrendTarget } from '../ai/trendContext';
import { buildResearchPrompt } from '../ai/researchPrompt';
import { Collapsible } from './Collapsible';
import { InfoTip } from './InfoTip';

/**
 * Sidebar panel for AI trend research (available in both metric modes). Holds the
 * API-key field and the "Research trend" flow, and renders the model's streamed
 * bullet-point output. The prompt always uses absolute per-source changes, so the
 * researched causes are identical regardless of the active view. Owns the research
 * runner registered on the state.
 */
export class AiResearchPanel {
  readonly root: HTMLDivElement;

  private readonly state: AiResearchState;
  private readonly dataset: EmissionsDataset;
  private readonly client = new TrendResearchClient();

  private readonly button: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private readonly outputEl: HTMLDivElement;

  constructor(parent: HTMLElement, state: AiResearchState, dataset: EmissionsDataset) {
    this.state = state;
    this.dataset = dataset;

    const panel = new Collapsible(parent, 'AI Research', 'ai-research-panel');
    this.root = panel.root;

    this.buildKeyField(panel.body);
    this.button = this.buildButton(panel.body);
    this.statusEl = this.buildStatus(panel.body);
    this.outputEl = this.buildOutput(panel.body);

    this.state.onRun((target) => void this.run(target));
    this.state.subscribe(() => this.sync());
    this.sync();
  }

  // --- build ---

  private buildKeyField(parent: HTMLElement): HTMLInputElement {
    const row = document.createElement('div');
    row.className = 'ai-research-panel__field';

    const label = document.createElement('label');
    label.className = 'ai-research-panel__label';
    label.textContent = 'Anthropic API key';

    new InfoTip(
      label,
      'Your key is used only in this browser to call the Anthropic API directly and is never stored or sent anywhere else.',
      'API key usage',
    );

    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.className = 'ai-research-panel__key';
    input.placeholder = 'sk-ant-…';
    input.addEventListener('input', () => {
      this.state.setApiKey(input.value);
      this.syncButton();
    });

    row.append(label, input);
    parent.appendChild(row);
    return input;
  }

  private buildButton(parent: HTMLElement): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai-research-panel__button';
    btn.textContent = 'Research trend';
    btn.addEventListener('click', () => this.onButton());
    parent.appendChild(btn);
    return btn;
  }

  private buildStatus(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'ai-research-panel__status';
    parent.appendChild(el);
    return el;
  }

  private buildOutput(parent: HTMLElement): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'ai-research-panel__output';
    parent.appendChild(el);
    return el;
  }

  // --- interaction ---

  private onButton(): void {
    const mode = this.state.mode();
    if (mode === 'selecting') this.state.cancelSelection();
    else this.state.beginSelection();
  }

  private async run(target: TrendTarget): Promise<void> {
    const context = buildTrendContext(this.dataset, target);
    if (context.factors.length === 0) {
      this.state.fail('No factor on this chart changed enough (≥5%) to research.');
      return;
    }
    const prompt = buildResearchPrompt(context);
    await this.client.research(this.state.apiKey(), prompt, {
      onText: (delta) => this.state.appendOutput(delta),
      onDone: (full) => this.state.finish(full),
      onError: (message) => this.state.fail(message),
    });
  }

  // --- render ---

  private sync(): void {
    this.syncButton();
    this.syncStatus();
    this.syncOutput();
  }

  private syncButton(): void {
    const selecting = this.state.mode() === 'selecting';
    const loading = this.state.mode() === 'loading';
    this.button.textContent = selecting ? 'Cancel selection' : 'Research trend';
    this.button.classList.toggle('ai-research-panel__button--active', selecting);
    this.button.disabled = loading || !this.state.hasKey();
  }

  private syncStatus(): void {
    const el = this.statusEl;
    el.className = 'ai-research-panel__status';
    el.textContent = '';

    switch (this.state.mode()) {
      case 'selecting':
        el.classList.add('ai-research-panel__status--prompt');
        el.textContent = 'Now click a single-country slope chart to research its trend.';
        break;
      case 'loading':
        el.classList.add('ai-research-panel__status--loading');
        el.append(this.spinner(), this.text('Researching the trend…'));
        break;
      case 'error':
        el.classList.add('ai-research-panel__status--error');
        el.textContent = this.state.error();
        break;
    }
  }

  private syncOutput(): void {
    const text = this.state.output();
    const visible = (this.state.mode() === 'done' || this.state.mode() === 'loading') && text.length > 0;
    this.outputEl.style.display = visible ? '' : 'none';
    this.outputEl.replaceChildren(...this.renderBullets(text));
  }

  /** Splits the model's markdown bullet output into list items with inline formatting. */
  private renderBullets(text: string): Node[] {
    if (!text) return [];
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const list = document.createElement('ul');
    list.className = 'ai-research-panel__list';
    for (const line of lines) {
      const li = document.createElement('li');
      // Strip the leading bullet marker only ("- "/"* "), never a "**bold" prefix.
      this.appendInlineMarkdown(li, line.replace(/^[-*]\s+/, ''));
      list.appendChild(li);
    }
    return [list];
  }

  /**
   * Renders inline markdown — bold, italic, and [label](url) links —
   * as DOM nodes. Text is added via textContent (never innerHTML), so model output
   * can't inject markup.
   */
  private appendInlineMarkdown(parent: HTMLElement, text: string): void {
    const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?:\*([^*]+)\*|_([^_]+)_)/g;
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parent.appendChild(document.createTextNode(text.slice(last, match.index)));
      const [, bold, linkLabel, linkUrl, italicStar, italicUnderscore] = match;
      if (bold !== undefined) {
        const strong = document.createElement('strong');
        strong.textContent = bold;
        parent.appendChild(strong);
      } else if (linkLabel !== undefined) {
        const a = document.createElement('a');
        a.textContent = linkLabel;
        a.href = linkUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        parent.appendChild(a);
      } else {
        const em = document.createElement('em');
        em.textContent = (italicStar ?? italicUnderscore)!;
        parent.appendChild(em);
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  private spinner(): HTMLElement {
    const s = document.createElement('span');
    s.className = 'ai-research-panel__spinner';
    return s;
  }

  private text(value: string): HTMLElement {
    const s = document.createElement('span');
    s.textContent = value;
    return s;
  }
}
