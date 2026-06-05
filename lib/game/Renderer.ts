import * as THREE from 'three';
import { EARTH_RADIUS } from './constants';

// How far the player can pull the camera back. Big enough to frame the whole
// heliocentric system (the outer planets sit thousands of units out), paired
// with the camera's large far-plane.
const MAX_ZOOM = 320;

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  private container: HTMLElement;
  private cameraTarget = new THREE.Vector3();
  private cameraOffset = new THREE.Vector3(0, 2, 8);
  private resizeObserver?: ResizeObserver;

  // Sky gradient: bright day at the surface → deep space with altitude.
  private skyDay = new THREE.Color(0x8ec9ff);
  private skySpace = new THREE.Color(0x05070f);
  private skyFade = 120; // altitude (units) over which day fades to space
  private skyScratch = new THREE.Color();
  private spaceVisibility = 0;
  private readonly spaceBackdrop = new THREE.Group();
  private readonly starMaterials: THREE.PointsMaterial[] = [];
  private readonly spaceMaterials: THREE.SpriteMaterial[] = [];
  private readonly spaceTextures: THREE.Texture[] = [];

  // User camera control state
  private userZoom    = 1.0;
  private userAzimuth = 0.0;
  private pointers    = new Map<number, { x: number; y: number }>();
  private lastSingleX = 0;
  private lastPinchDist = 0;

  // Rocket extent (units) used to auto-frame the craft on the pad so it is
  // always fully visible regardless of how big the build is.
  private rocketHeight = 3;
  // How far to lift the look target along "up" so the rocket sits centred.
  private targetLift = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(this.skyDay);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = this.skyDay.clone();
    this.scene.fog = new THREE.Fog(this.skyDay.clone(), 600, 3200);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200000);
    this.camera.position.set(0, EARTH_RADIUS + 2, 8);
    this.camera.lookAt(0, EARTH_RADIUS + 1, 0);

    // Bright, cheerful lighting for the "casual arcade" look.
    const hemi = new THREE.HemisphereLight(0xdff0ff, 0x4a5b78, 1.15);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xa9c2e0, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4);
    sun.position.set(80, 120, 60);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x9ed0ff, 0.6);
    fill.position.set(-80, -40, -60);
    this.scene.add(fill);

    this.buildSpaceBackdrop();

    this.handleResize();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.handleResize);

    // Camera touch controls on the canvas. Only fires in sim mode because
    // PlanControls (z-20 full-screen overlay) intercepts touches during planning.
    this.setupCameraControls();
  }

  private handleResize = () => {
    const w = this.container.clientWidth  || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  private seededRandom(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  private buildSpaceBackdrop() {
    this.scene.add(this.spaceBackdrop);
    this.buildStarLayer(1800, 4200, 1.15, 0xffffff, 0.22, 0x2f6b9d);
    this.buildStarLayer(260, 4400, 2.25, 0xd9f0ff, 0.42, 0x8d52c8);

    const nebulae: Array<{ theta: number; phi: number; scale: [number, number, number]; color: number; kind: 'nebula' | 'galaxy'; rotation: number }> = [
      { theta: 0.25, phi: 1.05, scale: [720, 320, 1], color: 0x5bd8ff, kind: 'nebula', rotation: -0.35 },
      { theta: 1.95, phi: 1.35, scale: [860, 360, 1], color: 0xb86dff, kind: 'nebula', rotation: 0.2 },
      { theta: 3.6,  phi: 1.0,  scale: [620, 260, 1], color: 0xff8ac8, kind: 'nebula', rotation: 0.8 },
      { theta: 4.85, phi: 1.4,  scale: [900, 260, 1], color: 0xffd47a, kind: 'galaxy', rotation: -0.6 },
      { theta: 2.75, phi: 0.72, scale: [520, 180, 1], color: 0xd8e8ff, kind: 'galaxy', rotation: 0.45 },
    ];

    for (const n of nebulae) {
      const tex = n.kind === 'galaxy'
        ? this.makeGalaxyTexture(n.color)
        : this.makeNebulaTexture(n.color);
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        fog: false,
        rotation: n.rotation,
      });
      const sprite = new THREE.Sprite(mat);
      const radius = 4100;
      sprite.position.set(
        radius * Math.sin(n.phi) * Math.cos(n.theta),
        radius * Math.cos(n.phi),
        radius * Math.sin(n.phi) * Math.sin(n.theta),
      );
      sprite.scale.set(...n.scale);
      this.spaceBackdrop.add(sprite);
      this.spaceMaterials.push(mat);
      this.spaceTextures.push(tex);
    }
  }

  private buildStarLayer(count: number, radius: number, size: number, color: number, hueJitter: number, seed: number) {
    const rand = this.seededRandom(seed);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const r = radius * (0.88 + rand() * 0.12);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
      const star = new THREE.Color(color).offsetHSL((rand() - 0.5) * hueJitter, 0, (rand() - 0.5) * 0.35);
      colors[i * 3] = star.r;
      colors[i * 3 + 1] = star.g;
      colors[i * 3 + 2] = star.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      size,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.starMaterials.push(mat);
    this.spaceBackdrop.add(new THREE.Points(geo, mat));
  }

  private makeNebulaTexture(colorHex: number): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const c = new THREE.Color(colorHex);
    const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
    const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    grad.addColorStop(0, `rgba(255,255,255,0.55)`);
    grad.addColorStop(0.18, `rgba(${r},${g},${b},0.35)`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.12)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeGalaxyTexture(colorHex: number): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const c = new THREE.Color(colorHex);
    const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
    ctx.translate(128, 128);
    ctx.scale(1, 0.32);
    const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 120);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)');
    glow.addColorStop(0.2, `rgba(${r},${g},${b},0.48)`);
    glow.addColorStop(0.75, `rgba(${r},${g},${b},0.16)`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,0.45)`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 78, 18 + i * 3, 0.2 + i * 0.28, 0, Math.PI * 1.45);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private setupCameraControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown',   this.onCamPointerDown);
    el.addEventListener('pointermove',   this.onCamPointerMove);
    el.addEventListener('pointerup',     this.onCamPointerUp);
    el.addEventListener('pointercancel', this.onCamPointerUp);
    el.addEventListener('wheel',         this.onCamWheel, { passive: false });
  }

  // Desktop mouse-wheel / trackpad zoom.
  private onCamWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0015);
    this.userZoom = Math.max(0.12, Math.min(MAX_ZOOM, this.userZoom * factor));
  };

  private onCamPointerDown = (e: PointerEvent) => {
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* ok */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.lastSingleX = e.clientX;
    } else if (this.pointers.size === 2) {
      const pts = Array.from(this.pointers.values());
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  };

  private onCamPointerMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      const dx = e.clientX - this.lastSingleX;
      this.userAzimuth += dx * 0.006;
      this.lastSingleX = e.clientX;
    } else if (this.pointers.size === 2) {
      const pts = Array.from(this.pointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (this.lastPinchDist > 1) {
        const ratio = dist / this.lastPinchDist;
        // Wide zoom range so the player can pull back far enough to see a whole
        // orbit, or push in close to the craft.
        this.userZoom = Math.max(0.12, Math.min(MAX_ZOOM, this.userZoom / ratio));
      }
      this.lastPinchDist = dist;
    }
  };

  private onCamPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      const [pt] = this.pointers.values();
      this.lastSingleX = pt.x;
    }
  };

  /** Lift the framed point up the craft's body so a tall rocket sits centred. */
  private liftedTarget(targetPos: THREE.Vector3, up?: THREE.Vector3): THREE.Vector3 {
    if (!up || this.targetLift <= 0) return targetPos;
    return targetPos.clone().addScaledVector(up, this.targetLift);
  }

  followTarget(targetPos: THREE.Vector3, dt: number, up?: THREE.Vector3) {
    const aim = this.liftedTarget(targetPos, up);
    if (this.cameraTarget.distanceTo(aim) > 24) this.cameraTarget.copy(aim);
    else this.cameraTarget.lerp(aim, 1 - Math.exp(-9 * dt));
    const desired = this.cameraTarget.clone().add(this.cameraOffset);
    this.camera.position.lerp(desired, 1 - Math.exp(-7 * dt));
    this.camera.lookAt(this.cameraTarget);
  }

  /** Snap the camera straight to its framed pose (no easing) — used on launch. */
  snapTo(targetPos: THREE.Vector3, up?: THREE.Vector3) {
    this.cameraTarget.copy(this.liftedTarget(targetPos, up));
    this.camera.position.copy(this.cameraTarget).add(this.cameraOffset);
    this.camera.lookAt(this.cameraTarget);
  }

  /** Record the built rocket's height so the pad view frames the whole stack. */
  setRocketHeight(height: number) {
    this.rocketHeight = Math.max(0.5, height);
  }

  updateCameraOffset(altitude: number) {
    const t = THREE.MathUtils.clamp(altitude / 150, 0, 1);
    const isDesktop = this.container.clientWidth >= 900;

    // Ground framing: pull back far enough that the full rocket fits the
    // vertical field of view (plus margin), so big builds aren't clipped.
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitDist = (this.rocketHeight * 0.62) / Math.tan(vfov / 2);
    const groundDist = Math.max(isDesktop ? 8 : 6, fitDist);
    const groundUp   = Math.max(isDesktop ? 3 : 2, this.rocketHeight * 0.5);

    const baseDist = THREE.MathUtils.lerp(groundDist, isDesktop ? 120 : 90, t);
    const upOff    = THREE.MathUtils.lerp(groundUp, isDesktop ? 28 : 22, t);
    // Centre the rocket body near the pad; fade the lift out once airborne so
    // the camera tracks the craft itself at altitude.
    this.targetLift = THREE.MathUtils.lerp(this.rocketHeight * 0.5, 0, Math.min(altitude / 8, 1));
    const dist     = baseDist * this.userZoom;
    this.cameraOffset.set(
      Math.sin(this.userAzimuth) * dist,
      upOff,
      Math.cos(this.userAzimuth) * dist,
    );
  }

  /** Configure the launch world's daytime sky and atmosphere depth. */
  setSky(dayHex: number, atmosphereHeight: number) {
    this.skyDay.setHex(dayHex);
    // Airless worlds read almost like open space even at the surface.
    this.skyFade = atmosphereHeight > 0 ? Math.max(120, atmosphereHeight * 1.6) : 30;
    this.updateSky(0);
  }

  /** Blend the sky from day → space as the craft climbs. */
  updateSky(altitude: number) {
    const t = THREE.MathUtils.clamp(altitude / this.skyFade, 0, 1);
    // Ease so the surface stays bright and it darkens nearer to space.
    const eased = t * t;
    this.spaceVisibility = THREE.MathUtils.smoothstep(t, 0.18, 0.92);
    this.skyScratch.copy(this.skyDay).lerp(this.skySpace, eased);
    (this.scene.background as THREE.Color).copy(this.skyScratch);
    (this.scene.fog as THREE.Fog).color.copy(this.skyScratch);
    this.renderer.setClearColor(this.skyScratch);

    for (const mat of this.starMaterials) {
      mat.opacity = THREE.MathUtils.lerp(0.035, 1, this.spaceVisibility);
    }
    for (const mat of this.spaceMaterials) {
      mat.opacity = 0.85 * this.spaceVisibility;
    }
  }

  render() {
    this.spaceBackdrop.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown',   this.onCamPointerDown);
    el.removeEventListener('pointermove',   this.onCamPointerMove);
    el.removeEventListener('pointerup',     this.onCamPointerUp);
    el.removeEventListener('pointercancel', this.onCamPointerUp);
    el.removeEventListener('wheel',         this.onCamWheel);

    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.spaceBackdrop.traverse((obj) => {
      if (obj instanceof THREE.Points) {
        obj.geometry.dispose();
      }
    });
    this.starMaterials.forEach((mat) => mat.dispose());
    this.spaceMaterials.forEach((mat) => mat.dispose());
    this.spaceTextures.forEach((tex) => tex.dispose());
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
