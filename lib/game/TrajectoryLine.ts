import * as THREE from 'three';

const MAX_POINTS = 1200;
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
const BULLSEYE_RADII = [32, 21, 8] as const;
const BULLSEYE_CROSSHAIR_INSET = 22;
const BULLSEYE_CROSSHAIR_OUTER_COORD = LANDING_MARKER_DIMENSION - BULLSEYE_CROSSHAIR_INSET;
const BULLSEYE_SHADOW_COLOR = 'rgba(10, 23, 38, 0.92)';
const BULLSEYE_RING_COLOR = '#ffffff';
const BULLSEYE_CROSSHAIR_COLOR = '#ff5577';
// Positions are in km; 1e-8 km² skips invalid sub-meter radial vectors before normalization.
const MIN_RADIAL_LENGTH_SQ = 1e-8;
// Hide apsis markers whose altitude is essentially at the surface (km), so the
// pad/ascent view doesn't show a stray "PE" pinned to the launch site.
const MIN_APSIS_ALT = 2;

export class TrajectoryLine {
  line: THREE.Line;
  /** Soft, wide additive underlay that gives the path a neon "glow". */
  private glow: THREE.Line;
  private group: THREE.Group;
  private positions: Float32Array;
  private colors: Float32Array;
  private glowColors: Float32Array;
  private geometry: THREE.BufferGeometry;
  private glowGeometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private glowMaterial: THREE.LineBasicMaterial;
  private baseColor = new THREE.Color(0x00e5ff);
  private apoMarker: THREE.Sprite;
  private periMarker: THREE.Sprite;
  private landingMarker: THREE.Mesh;
  private apoCanvas: HTMLCanvasElement;
  private periCanvas: HTMLCanvasElement;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.positions = new Float32Array(MAX_POINTS * 3);
    this.colors = new Float32Array(MAX_POINTS * 3);
    this.glowColors = new Float32Array(MAX_POINTS * 3);

    this.geometry  = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);

    // Crisp bright core line — vertex colours carry a head→tail brightness
    // gradient so the path reads as "flowing" toward the craft instead of a flat
    // uniform stroke.
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 3;

    // Wide, dim additive copy underneath fakes a soft glow/bloom around the core
    // without a full post-processing pass (keeps the casual-arcade look cheap).
    this.glowGeometry = new THREE.BufferGeometry();
    this.glowGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.glowGeometry.setAttribute('color', new THREE.BufferAttribute(this.glowColors, 3));
    this.glowGeometry.setDrawRange(0, 0);
    this.glowMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.glow = new THREE.Line(this.glowGeometry, this.glowMaterial);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 2;

    this.group.add(this.glow, this.line);
    this.group.visible = false;
    scene.add(this.group);

    const apo = this.makeMarker('AP', '#2ee59d');
    const peri = this.makeMarker('PE', '#00e5ff');
    const landing = this.makeLandingMarker();
    this.apoMarker = apo.sprite;
    this.periMarker = peri.sprite;
    this.landingMarker = landing.mesh;
    this.apoCanvas = apo.canvas;
    this.periCanvas = peri.canvas;
    scene.add(this.apoMarker, this.periMarker, this.landingMarker);
  }

  update(points: THREE.Vector3[], color = 0x00e5ff, focus?: THREE.Vector3, radius = 0, showLandingSite = false) {
    const n = Math.min(points.length, MAX_POINTS);
    this.baseColor.setHex(color);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      this.positions[i * 3]     = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      // Head→tail gradient: the segment nearest the craft (the path's start) is
      // brightest and fades along its length, so the orbit line has direction and
      // depth instead of a flat uniform stroke.
      const t = n > 1 ? i / (n - 1) : 0;
      const fade = 0.25 + 0.75 * (1 - t);            // 1.0 at head → 0.25 at tail
      this.colors[i * 3]     = this.baseColor.r * fade;
      this.colors[i * 3 + 1] = this.baseColor.g * fade;
      this.colors[i * 3 + 2] = this.baseColor.b * fade;
      const glowFade = fade * 0.6;
      this.glowColors[i * 3]     = this.baseColor.r * glowFade;
      this.glowColors[i * 3 + 1] = this.baseColor.g * glowFade;
      this.glowColors[i * 3 + 2] = this.baseColor.b * glowFade;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.glowGeometry.setDrawRange(0, n);
    this.glowGeometry.attributes.position.needsUpdate = true;
    this.glowGeometry.attributes.color.needsUpdate = true;
    this.glowGeometry.computeBoundingSphere();
    this.group.visible = n > 1;
    this.updateMarkers(points.slice(0, n), focus, radius, showLandingSite);
  }

  setVisible(v: boolean) {
    this.group.visible = v;
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
    const geo = new THREE.CircleGeometry(LANDING_MARKER_SCALE / 2, 32);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.visible = false;
    this.drawLandingMarker(canvas);
    return { mesh, canvas };
  }

  private drawLabel(canvas: HTMLCanvasElement, label: string, color: string) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Soft outer glow disc so the node reads as a luminous marker, not a flat dot.
    const glow = ctx.createRadialGradient(APSIS_DOT_X, APSIS_DOT_Y, 1, APSIS_DOT_X, APSIS_DOT_Y, 16);
    glow.addColorStop(0, color);
    glow.addColorStop(0.4, this.hexToRgba(color, 0.5));
    glow.addColorStop(1, this.hexToRgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(APSIS_DOT_X, APSIS_DOT_Y, 16, 0, Math.PI * 2);
    ctx.fill();

    // Crisp filled core dot with a dark rim for contrast against bright skies.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(10, 23, 38, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(APSIS_DOT_X, APSIS_DOT_Y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Label above the dot, with a dark halo so it stays legible everywhere.
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10, 23, 38, 0.92)';
    ctx.strokeText(label, APSIS_DOT_X, APSIS_LABEL_Y);
    ctx.fillStyle = color;
    ctx.fillText(label, APSIS_DOT_X, APSIS_LABEL_Y);
  }

  private hexToRgba(hex: string, alpha: number): string {
    const c = new THREE.Color(hex);
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
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
    let apoIdx = -1;
    let periIdx = -1;
    // Only accept apsides that are genuine local extrema along the path —
    // skip endpoints. Without this, the predicted arc that starts at the
    // rocket's current position spuriously labels the rocket itself as PE
    // (lowest point in a descending forecast) or AP (highest in an ascending
    // forecast), making the marker visually "glued" to the craft.
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const alt = p.distanceTo(focus) - radius;
      const prevAlt = points[i - 1].distanceTo(focus) - radius;
      const nextAlt = points[i + 1].distanceTo(focus) - radius;
      const isLocalMax = alt >= prevAlt && alt >= nextAlt;
      const isLocalMin = alt <= prevAlt && alt <= nextAlt;
      if (isLocalMax && alt > apoAlt) { apoAlt = alt; apo = p; apoIdx = i; }
      if (isLocalMin && alt < periAlt) { periAlt = alt; peri = p; periIdx = i; }
    }

    this.apoMarker.position.copy(apo);
    this.periMarker.position.copy(peri);
    // Suppress apsis labels that sit on the surface — on the pad and during early
    // ascent the "periapsis" is just the launch point, which looks broken.
    this.apoMarker.visible = apoIdx >= 0 && Number.isFinite(apoAlt) && apoAlt > MIN_APSIS_ALT;
    this.periMarker.visible = periIdx >= 0 && Number.isFinite(periAlt) && periAlt > MIN_APSIS_ALT
      && peri.distanceTo(apo) > 0.5;
    this.drawLabel(this.apoCanvas, 'AP', '#2ee59d');
    this.drawLabel(this.periCanvas, 'PE', '#00e5ff');
    (this.apoMarker.material as THREE.SpriteMaterial).map!.needsUpdate = true;
    (this.periMarker.material as THREE.SpriteMaterial).map!.needsUpdate = true;

    if (showLandingSite) {
      const site = points[points.length - 1];
      const radial = site.clone().sub(focus);
      const radialLengthSq = radial.lengthSq();
      if (radialLengthSq > MIN_RADIAL_LENGTH_SQ) {
        const radialNorm = radial.normalize();
        this.landingMarker.position.copy(focus).addScaledVector(
          radialNorm,
          radius + LANDING_MARKER_SURFACE_OFFSET,
        );
        // Orient the circle disc to lie flat on the terrain surface
        this.landingMarker.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          radialNorm,
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
    this.glowGeometry.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
    [this.apoMarker, this.periMarker].forEach((sprite) => {
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    const landingMat = this.landingMarker.material as THREE.MeshBasicMaterial;
    landingMat.map?.dispose();
    landingMat.dispose();
    (this.landingMarker.geometry as THREE.BufferGeometry).dispose();
  }
}
