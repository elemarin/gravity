import * as THREE from 'three';
import { EARTH_RADIUS } from './constants';

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  private container: HTMLElement;
  private cameraTarget = new THREE.Vector3();
  private cameraOffset = new THREE.Vector3(0, 2, 8);
  private resizeObserver?: ResizeObserver;

  // User camera control state
  private userZoom    = 1.0;
  private userAzimuth = 0.0;
  private pointers    = new Map<number, { x: number; y: number }>();
  private lastSingleX = 0;
  private lastPinchDist = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x06000d);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06000d);
    this.scene.fog = new THREE.Fog(0x06000d, 350, 900);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);
    this.camera.position.set(0, EARTH_RADIUS + 2, 8);
    this.camera.lookAt(0, EARTH_RADIUS + 1, 0);

    const ambient = new THREE.AmbientLight(0x221133, 0.9);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffddaa, 2.2);
    sun.position.set(80, 120, 60);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x2244aa, 0.4);
    fill.position.set(-80, -40, -60);
    this.scene.add(fill);

    this.buildStarfield();

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

  private buildStarfield() {
    const count = 900;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const radius = 700;
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * (0.7 + Math.random() * 0.3);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geo, mat));
  }

  private setupCameraControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown',   this.onCamPointerDown);
    el.addEventListener('pointermove',   this.onCamPointerMove);
    el.addEventListener('pointerup',     this.onCamPointerUp);
    el.addEventListener('pointercancel', this.onCamPointerUp);
  }

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
        this.userZoom = Math.max(0.18, Math.min(4.5, this.userZoom / ratio));
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

  followTarget(targetPos: THREE.Vector3, dt: number) {
    this.cameraTarget.lerp(targetPos, 1 - Math.exp(-5 * dt));
    const desired = this.cameraTarget.clone().add(this.cameraOffset);
    this.camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(this.cameraTarget);
  }

  updateCameraOffset(altitude: number) {
    const t = THREE.MathUtils.clamp(altitude / 150, 0, 1);
    const baseDist = THREE.MathUtils.lerp(6, 90, t);
    const upOff    = THREE.MathUtils.lerp(2, 22, t);
    const dist     = baseDist * this.userZoom;
    this.cameraOffset.set(
      Math.sin(this.userAzimuth) * dist,
      upOff,
      Math.cos(this.userAzimuth) * dist,
    );
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown',   this.onCamPointerDown);
    el.removeEventListener('pointermove',   this.onCamPointerMove);
    el.removeEventListener('pointerup',     this.onCamPointerUp);
    el.removeEventListener('pointercancel', this.onCamPointerUp);

    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
