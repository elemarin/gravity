import * as THREE from 'three';

const MAX_PARTICLES = 420;

export class Exhaust {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private maxLife: Float32Array;
  private geo: THREE.BufferGeometry;
  private active = false;

  constructor(scene: THREE.Scene) {
    this.positions  = new Float32Array(MAX_PARTICLES * 3);
    this.colors     = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.lifetimes  = new Float32Array(MAX_PARTICLES);
    this.maxLife    = new Float32Array(MAX_PARTICLES);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color',    new THREE.BufferAttribute(this.colors,    3));

    const mat = new THREE.PointsMaterial({
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geo, mat);
    scene.add(this.points);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.lifetimes[i] = 0;
      this.positions[i * 3] = 1e6;
    }
  }

  update(
    dt: number,
    nozzlePos: THREE.Vector3,
    thrustDir: THREE.Vector3,
    throttle: number,
  ) {
    this.active = throttle > 0.01;

    if (this.active) {
      this.spawn(nozzlePos, thrustDir, Math.round(18 + throttle * 36), (13 + Math.random() * 20) * throttle, 0.18, 0.18, [1, 0.88, 0.45]);
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lifetimes[i] <= 0) {
        this.positions[i * 3] = 1e6;
        continue;
      }
      this.lifetimes[i] += dt;
      if (this.lifetimes[i] > this.maxLife[i]) {
        this.lifetimes[i] = 0;
        this.positions[i * 3] = 1e6;
        continue;
      }

      this.positions[i * 3]     += this.velocities[i * 3]     * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      // Color aging: bright white-yellow → orange → dark red → fades to black
      const age = this.lifetimes[i] / this.maxLife[i];
      if (age < 0.25) {
        const t = age / 0.25;
        this.colors[i * 3]     = 1.0;
        this.colors[i * 3 + 1] = THREE.MathUtils.lerp(0.88, 0.42, t);
        this.colors[i * 3 + 2] = THREE.MathUtils.lerp(0.45, 0.0,  t);
      } else if (age < 0.6) {
        const t = (age - 0.25) / 0.35;
        this.colors[i * 3]     = THREE.MathUtils.lerp(1.0, 0.55, t);
        this.colors[i * 3 + 1] = THREE.MathUtils.lerp(0.42, 0.04, t);
        this.colors[i * 3 + 2] = 0.0;
      } else {
        const t = (age - 0.6) / 0.4;
        this.colors[i * 3]     = THREE.MathUtils.lerp(0.55, 0.0, t);
        this.colors[i * 3 + 1] = 0.0;
        this.colors[i * 3 + 2] = 0.0;
      }
    }

    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate    = true;

    const mat = this.points.material as THREE.PointsMaterial;
    mat.opacity = 1.0;
  }

  burst(origin: THREE.Vector3, dir: THREE.Vector3, count: number, color: [number, number, number], speed = 8) {
    this.spawn(origin, dir, count, speed, 0.9, 0.45, color);
  }

  private spawn(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    count: number,
    speed: number,
    spreadScale: number,
    life: number,
    color: [number, number, number],
  ) {
    let spawned = 0;
    const direction = dir.clone().normalize();
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      if (this.lifetimes[i] > 0) continue;
      this.positions[i * 3]     = origin.x + (Math.random() - 0.5) * 0.18;
      this.positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.18;
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.18;

      const particleSpeed = speed * (0.55 + Math.random() * 0.7);
      const spread = spreadScale * particleSpeed;
      this.velocities[i * 3]     = direction.x * particleSpeed + (Math.random() - 0.5) * spread;
      this.velocities[i * 3 + 1] = direction.y * particleSpeed + (Math.random() - 0.5) * spread;
      this.velocities[i * 3 + 2] = direction.z * particleSpeed + (Math.random() - 0.5) * spread;

      this.colors[i * 3]     = color[0];
      this.colors[i * 3 + 1] = color[1];
      this.colors[i * 3 + 2] = color[2];

      this.lifetimes[i] = 0.001;
      this.maxLife[i]   = life * (0.65 + Math.random() * 0.9);
      spawned++;
    }
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
