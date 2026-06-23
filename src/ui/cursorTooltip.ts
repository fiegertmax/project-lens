/** Singleton tooltip element that follows the cursor. */
let tip: HTMLDivElement | null = null;

function getTip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'cursor-tooltip cursor-tooltip--hidden';
    document.body.appendChild(tip);
  }
  return tip;
}

export function showCursorTooltip(text: string, clientX: number, clientY: number): void {
  const t = getTip();
  t.textContent = text;
  t.classList.remove('cursor-tooltip--hidden');
  const offset = 14;
  const x = Math.min(clientX + offset, window.innerWidth - t.offsetWidth - 8);
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${clientY + offset}px`;
}

export function hideCursorTooltip(): void {
  getTip().classList.add('cursor-tooltip--hidden');
}

/** Attaches a cursor-following tooltip to `el`. The tooltip appears on hover and tracks the pointer. */
export function attachCursorTooltip(el: HTMLElement, text: string): void {
  el.addEventListener('pointerenter', () => {
    const t = getTip();
    t.textContent = text;
    t.classList.remove('cursor-tooltip--hidden');
  });

  el.addEventListener('pointermove', (ev) => {
    const t = getTip();
    const offset = 14;
    const x = Math.min(ev.clientX + offset, window.innerWidth - t.offsetWidth - 8);
    const y = ev.clientY + offset;
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${y}px`;
  });

  el.addEventListener('pointerleave', () => {
    getTip().classList.add('cursor-tooltip--hidden');
  });
}
