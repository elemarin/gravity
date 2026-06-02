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

  followTarget(targetPos: THREE.Vector3, dt: number) {
    this.cameraTarget.lerp(targetPos, 1 - Math.exp(-5 * dt));
    const desired = this.cameraTarget.clone().add(this.cameraOffset);
    this.camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(this.cameraTarget);
  }

  updateCameraOffset(altitude: number) {
    const t = THREE.MathUtils.clamp(altitude / 150, 0, 1);
    const dist  = THREE.MathUtils.lerp(6, 90, t);
    const upOff = THREE.MathUtils.lerp(2, 22, t);
    this.cameraOffset.set(0, upOff, dist);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
