import * as THREE from 'three';

const MAX_PARTICLES = 700;

type ExhaustProfile = {
  fireColor: [number, number, number];
  smokeColor: [number, number, number];
  speed: number;
  spread: number;
  life: number;
  count: number;
  size: number;
};

const ENGINE_PROFILES: Record<string, ExhaustProfile> = {
  'engine-basic': {
    fireColor: [1.0, 0.55, 0.08],
    smokeColor: [0.55, 0.55, 0.55],
    speed: 1.8, spread: 0.9, life: 0.55, count: 22, size: 1.0,
  },
  'engine-vacuum': {
    fireColor: [0.55, 0.85, 1.0],
    smokeColor: [0.7, 0.85, 1.0],
    speed: 2.2, spread: 0.3, life: 0.45, count: 18, size: 0.7,
  },
  'engine-nuclear': {
    fireColor: [0.35, 1.0, 0.45],
    smokeColor: [0.6, 0.9, 0.65],
    speed: 1.5, spread: 1.2, life: 0.65, count: 28, size: 1.2,
  },
  'engine-ion': {
    fireColor: [0.25, 0.55, 1.0],
    smokeColor: [0.4, 0.6, 1.0],
    speed: 3.0, spread: 0.15, life: 0.3, count: 12, size: 0.5,
  },
};
const DEFAULT_PROFILE = ENGINE_PROFILES['engine-basic'];

export class Exhaust {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private maxLife: Float32Array;
  private isSmoke: Uint8Array;
  private geo: THREE.BufferGeometry;
  private mat: THREE.PointsMaterial;

  constructor(scene: THREE.Scene) {
    this.positions  = new Float32Array(MAX_PARTICLES * 3);
    this.colors     = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.lifetimes  = new Float32Array(MAX_PARTICLES);
    this.maxLife    = new Float32Array(MAX_PARTICLES);
    this.isSmoke    = new Uint8Array(MAX_PARTICLES);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color',    new THREE.BufferAttribute(this.colors,    3));

    this.mat = new THREE.PointsMaterial({
      size: 1.0,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.points = new THREE.Points(this.geo, this.mat);
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
    engineId = 'engine-basic',
  ) {
    const profile = ENGINE_PROFILES[engineId] ?? DEFAULT_PROFILE;
    this.mat.size = profile.size;

    if (throttle > 0.01) {
      const fireCount = Math.round(profile.count * throttle);
      const speed = profile.speed * (0.6 + Math.random() * 0.8) * throttle;
      // Fire/core: spawns at nozzle, goes in thrust direction (downward)
      this.spawn(nozzlePos, thrustDir, fireCount, speed, profile.spread, profile.life, profile.fireColor, false);

      // Smoke: spawns slightly above nozzle, drifts upward opposite to thrust
      const smokePos = nozzlePos.clone().addScaledVector(thrustDir, -0.25);
      const smokeCount = Math.round(fireCount * 0.6);
      this.spawn(smokePos, thrustDir.clone().negate(), smokeCount, 0.25 * throttle, 1.4, profile.life * 1.8, profile.smokeColor, true);
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

      const age = this.lifetimes[i] / this.maxLife[i];
      if (this.isSmoke[i]) {
        // Smoke fades out
        const fade = 1 - age;
        const base = this.colors[i * 3];
        this.colors[i * 3]     = base * fade;
        this.colors[i * 3 + 1] = this.colors[i * 3 + 1] * fade;
        this.colors[i * 3 + 2] = this.colors[i * 3 + 2] * fade;
      } else {
        // Fire color aging: bright → orange → red → dark
        if (age < 0.25) {
          const t = age / 0.25;
          this.colors[i * 3]     = 1.0;
          this.colors[i * 3 + 1] = THREE.MathUtils.lerp(this.colors[i * 3 + 1], 0.32, t * 0.4);
          this.colors[i * 3 + 2] = THREE.MathUtils.lerp(this.colors[i * 3 + 2], 0.0, t);
        } else if (age < 0.65) {
          const t = (age - 0.25) / 0.4;
          this.colors[i * 3]     = THREE.MathUtils.lerp(1.0, 0.45, t);
          this.colors[i * 3 + 1] = THREE.MathUtils.lerp(this.colors[i * 3 + 1], 0.04, t);
        } else {
          const t = (age - 0.65) / 0.35;
          this.colors[i * 3]     = THREE.MathUtils.lerp(0.45, 0.0, t);
          this.colors[i * 3 + 1] = 0;
          this.colors[i * 3 + 2] = 0;
        }
      }
    }

    this.geo.getAttribute('position').needsUpdate = true;
    this.geo.getAttribute('color').needsUpdate    = true;
  }

  burst(origin: THREE.Vector3, dir: THREE.Vector3, count: number, color: [number, number, number], speed = 4) {
    this.spawn(origin, dir, count, speed, 1.0, 0.55, color, false);
  }

  private spawn(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    count: number,
    speed: number,
    spreadScale: number,
    life: number,
    color: [number, number, number],
    smoke: boolean,
  ) {
    let spawned = 0;
    const direction = dir.clone().normalize();
    for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
      if (this.lifetimes[i] > 0) continue;
      this.positions[i * 3]     = origin.x + (Math.random() - 0.5) * 0.12;
      this.positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.12;
      this.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.12;

      const pSpeed = speed * (0.5 + Math.random() * 0.8);
      const spread = spreadScale * pSpeed;
      this.velocities[i * 3]     = direction.x * pSpeed + (Math.random() - 0.5) * spread;
      this.velocities[i * 3 + 1] = direction.y * pSpeed + (Math.random() - 0.5) * spread;
      this.velocities[i * 3 + 2] = direction.z * pSpeed + (Math.random() - 0.5) * spread;

      this.colors[i * 3]     = color[0];
      this.colors[i * 3 + 1] = color[1];
      this.colors[i * 3 + 2] = color[2];

      this.isSmoke[i]   = smoke ? 1 : 0;
      this.lifetimes[i] = 0.001;
      this.maxLife[i]   = life * (0.6 + Math.random() * 0.8);
      spawned++;
    }
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
