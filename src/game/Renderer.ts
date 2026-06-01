import * as THREE from 'three';
import { EARTH_RADIUS } from '../constants';

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  private cameraTarget = new THREE.Vector3();
  private cameraOffset = new THREE.Vector3(0, 2, 8);

  constructor() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0a0010);
    document.getElementById('canvas-container')!.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0010);
    this.scene.fog = new THREE.Fog(0x0a0010, 300, 800);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.01,
      2000
    );
    this.camera.position.set(0, EARTH_RADIUS + 2, 8);
    this.camera.lookAt(0, EARTH_RADIUS + 1, 0);

    // Lighting — PS1 style: ambient + one directional "sun"
    const ambient = new THREE.AmbientLight(0x221133, 0.9);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffddaa, 2.2);
    sun.position.set(80, 120, 60);
    this.scene.add(sun);

    // Dim fill light from opposite side
    const fill = new THREE.DirectionalLight(0x2244aa, 0.4);
    fill.position.set(-80, -40, -60);
    this.scene.add(fill);

    // Starfield
    this.buildStarfield();

    window.addEventListener('resize', () => this.onResize());
  }

  private buildStarfield() {
    const count = 800;
    const geo   = new THREE.BufferGeometry();
    const pos   = new Float32Array(count * 3);
    const radius = 600;

    for (let i = 0; i < count; i++) {
      // Random point on sphere surface
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = radius * (0.7 + Math.random() * 0.3);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    // Tiny white cubes as stars (PS1 vibe) — use Points for performance
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.35,
      sizeAttenuation: true,
    });
    const stars = new THREE.Points(geo, mat);
    this.scene.add(stars);

    // A handful of brighter star cubes for variety
    for (let i = 0; i < 40; i++) {
      const cubeGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
      const cubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const cube    = new THREE.Mesh(cubeGeo, cubeMat);
      const theta   = Math.random() * Math.PI * 2;
      const phi     = Math.acos(2 * Math.random() - 1);
      const r       = 300 + Math.random() * 200;
      cube.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
      this.scene.add(cube);
    }
  }

  /** Smoothly follow the rocket. */
  followTarget(targetPos: THREE.Vector3, dt: number) {
    this.cameraTarget.lerp(targetPos, 1 - Math.exp(-5 * dt));

    // Camera sits behind + above rocket
    const desired = this.cameraTarget.clone().add(this.cameraOffset);
    this.camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    this.camera.lookAt(this.cameraTarget);
  }

  /** Zoom out the camera offset as altitude increases. */
  updateCameraOffset(altitude: number) {
    // From close-up at launch to wide view at orbit
    const t = THREE.MathUtils.clamp(altitude / 150, 0, 1);
    const dist  = THREE.MathUtils.lerp(6, 80, t);
    const upOff = THREE.MathUtils.lerp(2, 20, t);
    this.cameraOffset.set(0, upOff, dist);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
