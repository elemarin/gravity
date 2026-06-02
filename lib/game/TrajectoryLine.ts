import * as THREE from 'three';

const MAX_POINTS = 500;
const APSIS_MARKER_SIZE = 96;
const APSIS_MARKER_SCALE = 1.7;
const APSIS_DOT_X = APSIS_MARKER_SIZE / 2;
const APSIS_DOT_Y = APSIS_MARKER_SIZE / 2;
const APSIS_LABEL_Y = APSIS_MARKER_SIZE / 4;
const LANDING_MARKER_DIMENSION = 128;
const LANDING_MARKER_SCALE = 2.5;
const LANDING_MARKER_SURFACE_OFFSET = 0.04;
const LANDING_CENTER = LANDING_MARKER_DIMENSION / 2;
// Three rings at roughly half, one-third, and center-dot radius keep the 128px bullseye readable when scaled down.
const BULLSEYE_RADII = [34, 21, 8] as const;
const BULLSEYE_CROSSHAIR_INSET = 22;
const BULLSEYE_CROSSHAIR_OUTER_COORD = LANDING_MARKER_DIMENSION - BULLSEYE_CROSSHAIR_INSET;
const BULLSEYE_SHADOW_COLOR = 'rgba(10, 23, 38, 0.92)';
const BULLSEYE_RING_COLOR = '#ffffff';
const BULLSEYE_CROSSHAIR_COLOR = '#ff5577';
// Squared distance threshold to avoid normalizing a nearly zero radial vector when the predicted site is invalid.
const MIN_RADIAL_LENGTH_SQ = 1e-8;

export class TrajectoryLine {
  line: THREE.Line;
  private positions: Float32Array;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private apoMarker: THREE.Sprite;
  private periMarker: THREE.Sprite;
  private landingMarker: THREE.Sprite;
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
    const landing = this.makeLandingMarker();
    this.apoMarker = apo.sprite;
    this.periMarker = peri.sprite;
    this.landingMarker = landing.sprite;
    this.apoCanvas = apo.canvas;
    this.periCanvas = peri.canvas;
    scene.add(this.apoMarker, this.periMarker, this.landingMarker);
  }

  update(points: THREE.Vector3[], color = 0x00e5ff, focus?: THREE.Vector3, radius = 0, showLandingSite = false) {
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
    this.updateMarkers(points.slice(0, n), focus, radius, showLandingSite);
  }

  setVisible(v: boolean) {
    this.line.visible = v;
    this.apoMarker.visible = v && this.apoMarker.visible;
    this.periMarker.visible = v && this.periMarker.visible;
    this.landingMarker.visible = v && this.landingMarker.visible;
  }

  private makeMarker(label: string, color: string) {
    const canvas = document.createElement('canvas');
    canvas.width = APSIS_MARKER_SIZE;
    canvas.height = APSIS_MARKER_SIZE;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(APSIS_MARKER_SCALE, APSIS_MARKER_SCALE, 1);
    sprite.visible = false;
    this.drawLabel(canvas, label, color);
    return { sprite, canvas };
  }

  private makeLandingMarker() {
    const canvas = document.createElement('canvas');
    canvas.width = LANDING_MARKER_DIMENSION;
    canvas.height = LANDING_MARKER_DIMENSION;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(LANDING_MARKER_SCALE, LANDING_MARKER_SCALE, 1);
    sprite.visible = false;
    this.drawLandingMarker(canvas);
    return { sprite, canvas };
  }

  private drawLabel(canvas: HTMLCanvasElement, label: string, color: string) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(10, 23, 38, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(APSIS_DOT_X, APSIS_DOT_Y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();

    ctx.font = '700 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(label, APSIS_DOT_X, APSIS_LABEL_Y);
    ctx.fillText(label, APSIS_DOT_X, APSIS_LABEL_Y);
  }

  private drawLandingMarker(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    this.strokeBullseyeRings(ctx, BULLSEYE_SHADOW_COLOR, 8);
    this.strokeBullseyeRings(ctx, BULLSEYE_RING_COLOR, 4);

    ctx.strokeStyle = BULLSEYE_CROSSHAIR_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(LANDING_CENTER, BULLSEYE_CROSSHAIR_INSET);
    ctx.lineTo(LANDING_CENTER, BULLSEYE_CROSSHAIR_OUTER_COORD);
    ctx.moveTo(BULLSEYE_CROSSHAIR_INSET, LANDING_CENTER);
    ctx.lineTo(BULLSEYE_CROSSHAIR_OUTER_COORD, LANDING_CENTER);
    ctx.stroke();
  }

  private strokeBullseyeRings(ctx: CanvasRenderingContext2D, strokeStyle: string, lineWidth: number) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    for (const r of BULLSEYE_RADII) {
      ctx.beginPath();
      ctx.arc(LANDING_CENTER, LANDING_CENTER, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private updateMarkers(points: THREE.Vector3[], focus?: THREE.Vector3, radius = 0, showLandingSite = false) {
    if (!focus || points.length < 4) {
      this.apoMarker.visible = false;
      this.periMarker.visible = false;
      this.landingMarker.visible = false;
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
    this.drawLabel(this.apoCanvas, 'AP', '#2ee59d');
    this.drawLabel(this.periCanvas, 'PE', '#00e5ff');
    (this.apoMarker.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    (this.periMarker.material as THREE.SpriteMaterial).map!.needsUpdate = true;

    if (showLandingSite) {
      const site = points[points.length - 1];
      const radial = site.clone().sub(focus);
      const radialLengthSq = radial.lengthSq();
      if (radialLengthSq > MIN_RADIAL_LENGTH_SQ) {
        this.landingMarker.position.copy(focus).addScaledVector(
          radial.normalize(),
          radius + LANDING_MARKER_SURFACE_OFFSET,
        );
        this.landingMarker.visible = true;
      } else {
        this.landingMarker.visible = false;
      }
    } else {
      this.landingMarker.visible = false;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    [this.apoMarker, this.periMarker, this.landingMarker].forEach((sprite) => {
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
  }
}
