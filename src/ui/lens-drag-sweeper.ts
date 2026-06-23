import { LENS_ICON } from './icons';

/** Pointer travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

export interface LensDragSweeperOptions<T> {
  /** Hit-test the element under the pointer; return the conceptual target or null. */
  resolveTarget(x: number, y: number): T | null;
  /** Called whenever the hovered target changes; receives the previous target too. */
  onHover?(target: T | null, previous: T | null): void;
  /** Called once on pointer release; `visited` is every unique target hovered during the drag. */
  onDrop(target: T | null, opts: { shift: boolean; visited: Set<T>; clientX: number; clientY: number }): void;
  /** Called for every newly-hovered target while Shift is held (additive sweep). */
  onSweep?(target: T): void;
  /** Checked right before the ghost is created; return false to cancel the drag. */
  canStart?(): boolean;
  /** Per-move drop validity at the pointer; false renders a red 'x' on the ghost and blocks the drop. */
  canDrop?(target: T | null, clientX: number, clientY: number): boolean;
}

/** Wires pointer-based ghost-drag onto a handle. Shared by the line-chart and pie-chart
 *  lens drag controllers — encapsulates the threshold, ghost element, body class, and
 *  event lifecycle so each controller only supplies hit-test + drop semantics. */
export function createLensDragSweeper<T>(
  handle: Element,
  options: LensDragSweeperOptions<T>,
): void {
  let origin: { x: number; y: number } | null = null;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let hovered: T | null = null;
  const sweptKeys = new Set<T>();
  const visitedTargets = new Set<T>();

  const begin = (): void => {
    dragging = true;
    ghost = document.createElement('div');
    ghost.className = 'lens-ghost';
    ghost.innerHTML = LENS_ICON;
    document.body.append(ghost);
  };

  const moveGhost = (event: PointerEvent): void => {
    if (!ghost) return;
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
  };

  const setHover = (target: T | null): void => {
    if (hovered === target) return;
    options.onHover?.(target, hovered);
    hovered = target;
    if (target !== null) visitedTargets.add(target);
  };

  const end = (): void => {
    setHover(null);
    ghost?.remove();
    ghost = null;
    dragging = false;
    origin = null;
    sweptKeys.clear();
    visitedTargets.clear();
    document.body.classList.remove('lens-dragging');
    window.dispatchEvent(new CustomEvent('lens-drag-end'));
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  const onMove = (event: PointerEvent): void => {
    if (!origin) return;
    if (!dragging) {
      const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (moved < DRAG_THRESHOLD) return;
      if (options.canStart && !options.canStart()) {
        end();
        return;
      }
      begin();
    }
    moveGhost(event);
    const target = options.resolveTarget(event.clientX, event.clientY);
    setHover(target);
    const droppable = options.canDrop ? options.canDrop(target, event.clientX, event.clientY) : true;
    ghost?.classList.toggle('lens-ghost--no-drop', !droppable);
    if (event.shiftKey && target && !sweptKeys.has(target)) {
      sweptKeys.add(target);
      options.onSweep?.(target);
    }
  };

  const onUp = (event: PointerEvent): void => {
    if (dragging) {
      const target = options.resolveTarget(event.clientX, event.clientY);
      if (target !== null) visitedTargets.add(target);
      const droppable = options.canDrop ? options.canDrop(target, event.clientX, event.clientY) : true;
      if (droppable) {
        options.onDrop(target, { shift: event.shiftKey, visited: new Set(visitedTargets), clientX: event.clientX, clientY: event.clientY });
      }
    }
    end();
  };

  handle.addEventListener('pointerdown', (event) => {
    const pointer = event as PointerEvent;
    if (pointer.button !== 0) return;
    origin = { x: pointer.clientX, y: pointer.clientY };
    document.body.classList.add('lens-dragging');
    window.dispatchEvent(new CustomEvent('lens-drag-start'));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}
