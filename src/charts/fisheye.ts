/** Circular fisheye distortion, ported to TypeScript from Jason Davies'
 *  d3-plugins fisheye (the version bundled in the sibling fisheye-lens project).
 *  Points within `radius` of the focus are magnified toward it; the rest pass
 *  through unchanged. `z` is the local zoom factor at the returned point. */
export interface FisheyePoint {
  x: number;
  y: number;
  z: number;
}

export class CircularFisheye {
  private radiusValue: number;
  private distortionValue: number;
  private focusValue: [number, number] = [0, 0];
  private k0 = 0;
  private k1 = 0;

  constructor(radius = 200, distortion = 2) {
    this.radiusValue = radius;
    this.distortionValue = distortion;
    this.rescale();
  }

  focus(point: [number, number]): this {
    this.focusValue = point;
    return this;
  }

  radius(radius: number): this {
    this.radiusValue = radius;
    return this.rescale();
  }

  distortion(distortion: number): this {
    this.distortionValue = distortion;
    return this.rescale();
  }

  apply(x: number, y: number): FisheyePoint {
    const dx = x - this.focusValue[0];
    const dy = y - this.focusValue[1];
    const dd = Math.sqrt(dx * dx + dy * dy);
    if (!dd || dd >= this.radiusValue) return { x, y, z: dd >= this.radiusValue ? 1 : 10 };
    const k = (this.k0 * (1 - Math.exp(-dd * this.k1))) / dd * 0.75 + 0.25;
    return { x: this.focusValue[0] + dx * k, y: this.focusValue[1] + dy * k, z: Math.min(k, 10) };
  }

  private rescale(): this {
    const e = Math.exp(this.distortionValue);
    this.k0 = (e / (e - 1)) * this.radiusValue;
    this.k1 = this.distortionValue / this.radiusValue;
    return this;
  }
}
