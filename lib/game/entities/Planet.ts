import * as THREE from 'three';
import { Body } from '../bodies';

/**
 * Renders any celestial {@link Body} as a low-poly sphere with optional
 * atmosphere shell. Used for Earth, the Moon and any future planets so the
 * scene can be built straight from a scenario's body list.
 */
export class Planet {
  mesh: THREE.Group;
  readonly body: Body;

  constructor(scene: THREE.Scene, body: Body) {
    this.body = body;
    this.mesh = new THREE.Group();

    const geo = new THREE.IcosahedronGeometry(body.radius, body.radius > 30 ? 2 : 1);
    const posAttr = geo.getAttribute('position');
    const colors: number[] = [];
    const base = new THREE.Color(body.color);
    const dark = base.clone().multiplyScalar(0.6);
    const light = base.clone().lerp(new THREE.Color(0xffffff), 0.18);

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      const noise = Math.sin(x * 3.7 + y * 2.1 + z * 5.3) * 0.5 + 0.5;
      const c = noise > 0.55 ? light : noise > 0.38 ? base : dark;
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 8 });
    this.mesh.add(new THREE.Mesh(geo, mat));

    if (body.atmosphereHeight > 0) {
      const atmGeo = new THREE.IcosahedronGeometry(body.radius + 2, 1);
      const atmMat = new THREE.MeshPhongMaterial({
        color: 0x4499ff,
        flatShading: true,
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
      });
      this.mesh.add(new THREE.Mesh(atmGeo, atmMat));
    }

    this.mesh.position.copy(body.center);
    scene.add(this.mesh);
  }

  update(dt: number) {
    this.mesh.rotation.y += 0.002 * dt;
  }

  dispose() {
    this.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }
}
