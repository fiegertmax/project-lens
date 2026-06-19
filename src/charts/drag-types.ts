// Coordinates are viewport-space (event.sourceEvent.clientX/Y, not SVG-local event.x)
// because ChartArea uses document.elementFromPoint(clientX, clientY) for drop detection.
export interface LineDragCallbacks {
  onDragStart(country: string, clientX: number, clientY: number): void;
  onDragMove(country: string, clientX: number, clientY: number): void;
  onDragEnd(country: string, clientX: number, clientY: number): void;
}
