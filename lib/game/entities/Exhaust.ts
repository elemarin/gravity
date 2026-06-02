import * as THREE from 'three';

const MAX_PARTICLES = 60;

export class Exhaust {
  private points: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private maxLife: Float32Array;
  private geo: THREE.BufferGeometry;
  private active = false;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.lifetimes  = new Float32Array(MAX_PARTICLES);
    this.maxLife    = new Float32Array(MAX_PARTICLES);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const sizes = new Float32Array(MAX_PARTICLES).fill(0.18);
    this.geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      color: 0xff6600,
      size: 0.22,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geo, mat);
    scene.add(this.points);

    // init all particles as dead
    for (let i = 0; i < MAX_PARTICLES; i++) this.lifetimes[i] = 0;
  }

  /** Called each frame. nozzlePos = world position of engine nozzle. thrustDir = unit vector of thrust direction (away from nozzle). */
  update(
    dt: number,
    nozzlePos: THREE.Vector3,
    thrustDir: THREE.Vector3,
    throttle: number
  ) {
    this.active = throttle > 0.01;

    // Spawn new particles proportional to throttle
    if (this.active) {
      const spawnCount = Math.floor(throttle * 8);
      let spawned = 0;
      for (let i = 0; i < MAX_PARTICLES && spawned < spawnCount; i++) {
        if (this.lifetimes[i] <= 0) {
          const spread = 0.15;
          this.positions[i * 3]     = nozzlePos.x + (Math.random() - 0.5) * spread;
          this.positions[i * 3 + 1] = nozzlePos.y + (Math.random() - 0.5) * spread;
          this.positions[i * 3 + 2] = nozzlePos.z + (Math.random() - 0.5) * spread;

          const speed = 3 + Math.random() * 4;
          this.velocities[i * 3]     = thrustDir.x * speed + (Math.random() - 0.5) * 0.8;
          this.velocities[i * 3 + 1] = thrustDir.y * speed + (Math.random() - 0.5) * 0.8;
          this.velocities[i * 3 + 2] = thrustDir.z * speed + (Math.random() - 0.5) * 0.8;

          this.lifetimes[i] = 0.001; // just born
          this.maxLife[i]   = 0.3 + Math.random() * 0.3;
          spawned++;
        }
      }
    }

    // Age & move particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.lifetimes[i] <= 0) {
        // park dead particle far away
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
    }

    this.geo.getAttribute('position').needsUpdate = true;

    // Cycle color between orange and yellow based on throttle/time
    const t = (Date.now() % 400) / 400;
    const mat = this.points.material as THREE.PointsMaterial;
    mat.color.setHex(t > 0.5 ? 0xffaa00 : 0xff4400);
    mat.opacity = this.active ? 0.8 : 0;
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
