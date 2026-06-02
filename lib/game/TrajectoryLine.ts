import * as THREE from 'three';

const MAX_POINTS = 500;

export class TrajectoryLine {
  line: THREE.Line;
  private positions: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private apoMarker: THREE.Sprite;
  private periMarker: THREE.Sprite;
  private apoCanvas: HTMLCanvasElement;
  private periCanvas: HTMLCanvasElement;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_POINTS * 3);
    this.geometry  = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.6,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    const apo = this.makeMarker('AP', '#2ee59d');
    const peri = this.makeMarker('PE', '#00e5ff');
    this.apoMarker = apo.sprite;
    this.periMarker = peri.sprite;
    this.apoCanvas = apo.canvas;
    this.periCanvas = peri.canvas;
    scene.add(this.apoMarker, this.periMarker);
  }

  update(points: THREE.Vector3[], color = 0x00e5ff, focus?: THREE.Vector3, radius = 0) {
    const n = Math.min(points.length, MAX_POINTS);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      this.positions[i * 3]     = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.material.color.setHex(color);
    this.line.visible = n > 1;
    this.updateMarkers(points.slice(0, n), focus, radius);
  }

  setVisible(v: boolean) {
    this.line.visible = v;
    this.apoMarker.visible = v && this.apoMarker.visible;
    this.periMarker.visible = v && this.periMarker.visible;
  }

  private makeMarker(label: string, color: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(9, 3.4, 1);
    sprite.visible = false;
    this.drawLabel(canvas, label, color);
    return { sprite, canvas };
  }

  private drawLabel(canvas: HTMLCanvasElement, label: string, color: string) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(10, 23, 38, 0.78)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(10, 12, 236, 72, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '700 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 48);
  }

  private updateMarkers(points: THREE.Vector3[], focus?: THREE.Vector3, radius = 0) {
    if (!focus || points.length < 4) {
      this.apoMarker.visible = false;
      this.periMarker.visible = false;
      return;
    }

    let apo = points[0];
    let peri = points[0];
    let apoAlt = -Infinity;
    let periAlt = Infinity;
    for (const p of points) {
      const alt = p.distanceTo(focus) - radius;
      if (alt > apoAlt) { apoAlt = alt; apo = p; }
      if (alt < periAlt) { periAlt = alt; peri = p; }
    }

    this.apoMarker.position.copy(apo);
    this.periMarker.position.copy(peri);
    this.apoMarker.visible = Number.isFinite(apoAlt);
    this.periMarker.visible = Number.isFinite(periAlt) && peri.distanceTo(apo) > 0.5;
    this.drawLabel(this.apoCanvas, `AP ${this.fmtAlt(apoAlt)}`, '#2ee59d');
    this.drawLabel(this.periCanvas, `PE ${this.fmtAlt(Math.max(0, periAlt))}`, '#00e5ff');
    (this.apoMarker.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    (this.periMarker.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  private fmtAlt(km: number): string {
    if (km >= 1000) return `${(km / 1000).toFixed(1)}Mm`;
    return `${Math.round(km)}km`;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    [this.apoMarker, this.periMarker].forEach((sprite) => {
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
  }
}
