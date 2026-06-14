export type PieLensLevel = 'country' | 'source';

export interface PieLensRecord {
  /** Stable id used to track DOM nodes and drag retargeting. */
  id: string;
  /** Determines the slices the lens shows. */
  level: PieLensLevel;
  /** Continent name (level=country) or country name (level=source). */
  target: string;
  /** Pixel offset of the lens's top-left inside the main area container. */
  position: { x: number; y: number };
}

type Listener = () => void;

/** Observable collection of pie-chart drill-down lenses. Spawned by the sidebar
 *  lens icon; retargeted in place by dragging a lens onto a same-level slice. */
export class PieLensState {
  private readonly lenses: PieLensRecord[] = [];
  private readonly listeners = new Set<Listener>();
  private nextId = 1;

  list(): PieLensRecord[] {
    return [...this.lenses];
  }

  /** Add a new lens, unless one with the same (level, target) already exists. */
  spawn(level: PieLensLevel, target: string, position: { x: number; y: number }): PieLensRecord | undefined {
    if (this.lenses.some((l) => l.level === level && l.target === target)) return undefined;
    const id = String(this.nextId++);
    const lens: PieLensRecord = { id, level, target, position };
    this.lenses.push(lens);
    this.notify();
    return lens;
  }

  /** Point an existing lens at a different same-level entity. No-op when another
   *  lens of the same level is already showing the destination, to keep each
   *  entity unique across open lenses. */
  retarget(id: string, target: string): void {
    const index = this.lenses.findIndex((l) => l.id === id);
    if (index < 0) return;
    const lens = this.lenses[index];
    if (lens.target === target) return;
    if (this.lenses.some((l) => l.id !== id && l.level === lens.level && l.target === target)) return;
    // Replace (don't mutate) so subscribers can detect the change via reference equality.
    this.lenses[index] = { ...lens, target };
    this.notify();
  }

  /** Reposition (e.g. after user-drag of the header). */
  moveTo(id: string, position: { x: number; y: number }): void {
    const index = this.lenses.findIndex((l) => l.id === id);
    if (index < 0) return;
    this.lenses[index] = { ...this.lenses[index], position };
    this.notify();
  }

  remove(id: string): void {
    const index = this.lenses.findIndex((l) => l.id === id);
    if (index < 0) return;
    this.lenses.splice(index, 1);
    this.notify();
  }

  clear(): void {
    if (this.lenses.length === 0) return;
    this.lenses.length = 0;
    this.notify();
  }

  count(): number {
    return this.lenses.length;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
