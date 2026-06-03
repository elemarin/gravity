import * as THREE from 'three';

/** Per-engine flame tint: [core, mid, outer] as hex. */
const FLAME_PALETTES: Record<string, [number, number, number]> = {
  'engine-basic':  [0xfff3c0, 0xffb24a, 0xff5a2a],
  'engine-heavy':  [0xfff0b0, 0xffa838, 0xff4d1f],
  'engine-vacuum': [0xe8f6ff, 0x9fd2ff, 0x4f9bff],
  'engine-nuclear':[0xeafff0, 0x9bffc4, 0x33e07a],
  'engine-ion':    [0xe6f0ff, 0x9ab8ff, 0x5b7bff],
};
const DEFAULT_PALETTE = FLAME_PALETTES['engine-basic'];

function radialGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,240,200,0.95)');
  g.addColorStop(0.4, 'rgba(255,170,70,0.55)');
  g.addColorStop(1, 'rgba(255,90,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/**
 * Low-poly rocket flame: a stack of nested cones that flicker with throttle,
 * plus a soft additive glow at the nozzle. Cheap, readable and stylised —
 * no particle system.
 */
export class Flame {
  group: THREE.Group;
  private cones: THREE.Mesh[] = [];
  private mats: THREE.MeshBasicMaterial[] = [];
  private glow: THREE.Sprite;
  private baseLengths: number[];
  private flicker = 0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.visible = false;

    // Three nested cones, longest+faintest on the outside. Each points down
    // local -Y (apex downstream) with its mouth at the nozzle (y = 0).
    const specs: { r: number; h: number; color: number; op: number; seg: number }[] = [
      { r: 0.18, h: 1.5,  color: DEFAULT_PALETTE[2], op: 0.45, seg: 7 },
      { r: 0.13, h: 1.05, color: DEFAULT_PALETTE[1], op: 0.7,  seg: 6 },
      { r: 0.07, h: 0.6,  color: DEFAULT_PALETTE[0], op: 0.95, seg: 5 },
    ];
    this.baseLengths = specs.map((s) => s.h);
    for (const s of specs) {
      const geo = new THREE.ConeGeometry(s.r, s.h, s.seg);
      geo.rotateX(Math.PI);                 // apex now points -Y
      geo.translate(0, -s.h / 2, 0);        // mouth sits at y = 0
      const mat = new THREE.MeshBasicMaterial({
        color: s.color,
        transparent: true,
        opacity: s.op,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.cones.push(mesh);
      this.mats.push(mat);
      this.group.add(mesh);
    }

    const glowMat = new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(0.8, 0.8, 0.8);
    this.group.add(this.glow);

    scene.add(this.group);
  }

  private applyPalette(engineId: string) {
    const pal = FLAME_PALETTES[engineId] ?? DEFAULT_PALETTE;
    this.mats[0].color.setHex(pal[2]);
    this.mats[1].color.setHex(pal[1]);
    this.mats[2].color.setHex(pal[0]);
  }

  update(
    dt: number,
    nozzlePos: THREE.Vector3,
    thrustDir: THREE.Vector3,   // direction exhaust travels (away from craft)
    throttle: number,
    engineId = 'engine-basic',
  ) {
    if (throttle <= 0.01) { this.group.visible = false; return; }
    this.group.visible = true;
    this.applyPalette(engineId);

    this.group.position.copy(nozzlePos);
    // Orient local -Y onto the exhaust direction.
    this.group.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, -1, 0), thrustDir.clone().normalize(),
    );

    this.flicker += dt * 30;
    const wobble = 0.82 + 0.18 * Math.sin(this.flicker) + (Math.random() - 0.5) * 0.12;
    const len = throttle * wobble;
    for (let i = 0; i < this.cones.length; i++) {
      const c = this.cones[i];
      c.scale.y = len;
      c.scale.x = c.scale.z = 0.7 + 0.3 * throttle + (Math.random() - 0.5) * 0.06;
    }
    const glowScale = (0.5 + throttle * 0.8) * (0.9 + Math.random() * 0.2);
    this.glow.scale.set(glowScale, glowScale, glowScale);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.5 + throttle * 0.45;
  }

  dispose() {
    this.cones.forEach((c) => c.geometry.dispose());
    this.mats.forEach((m) => m.dispose());
    const gm = this.glow.material as THREE.SpriteMaterial;
    gm.map?.dispose();
    gm.dispose();
  }
}

/**
 * Pooled one-shot flashes for stage separation / parachute deployment —
 * expanding additive sprites that fade out. Replaces the old particle bursts.
 */
export class FxBursts {
  private sprites: THREE.Sprite[] = [];
  private vel: THREE.Vector3[] = [];
  private life: number[] = [];
  private maxLife: number[] = [];
  private tex: THREE.Texture;
  private scene: THREE.Scene;
  private readonly MAX = 24;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.tex = radialGlowTexture();
    for (let i = 0; i < this.MAX; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      this.sprites.push(sp);
      this.vel.push(new THREE.Vector3());
      this.life.push(0);
      this.maxLife.push(0.5);
      scene.add(sp);
    }
  }

  burst(origin: THREE.Vector3, dir: THREE.Vector3, count: number, color: number, spread = 0.9) {
    let spawned = 0;
    for (let i = 0; i < this.MAX && spawned < count; i++) {
      if (this.life[i] > 0) continue;
      const sp = this.sprites[i];
      (sp.material as THREE.SpriteMaterial).color.setHex(color);
      sp.position.copy(origin);
      sp.visible = true;
      const v = dir.clone().multiplyScalar(1.2 + Math.random() * 1.6);
      v.x += (Math.random() - 0.5) * spread * 2;
      v.y += (Math.random() - 0.5) * spread * 2;
      v.z += (Math.random() - 0.5) * spread * 2;
      this.vel[i].copy(v);
      this.life[i] = 0.001;
      this.maxLife[i] = 0.4 + Math.random() * 0.3;
      spawned++;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.maxLife[i];
      if (t >= 1) { this.life[i] = 0; this.sprites[i].visible = false; continue; }
      const sp = this.sprites[i];
      sp.position.addScaledVector(this.vel[i], dt);
      const s = 0.4 + t * 1.6;
      sp.scale.set(s, s, s);
      (sp.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.9;
    }
  }

  dispose() {
    this.sprites.forEach((sp) => {
      this.scene.remove(sp);
      (sp.material as THREE.SpriteMaterial).dispose();
    });
    this.tex.dispose();
  }
}
