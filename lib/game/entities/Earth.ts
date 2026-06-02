import * as THREE from 'three';
import { EARTH_CENTER, EARTH_RADIUS } from '../constants';

export class Earth {
  mesh: THREE.Group;
  private sphere: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Group();

    // Low-poly icosahedron for the main sphere
    const geo = new THREE.IcosahedronGeometry(EARTH_RADIUS, 2);

    // Apply vertex colors for land/ocean variety
    const posAttr = geo.getAttribute('position');
    const colors: number[] = [];
    const landColor   = new THREE.Color(0x2d7a3a);
    const oceanColor  = new THREE.Color(0x1a4f8a);
    const shallowColor = new THREE.Color(0x246b55);

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      // Simple pseudo-random coloring using vertex position
      const noise = Math.sin(x * 3.7 + y * 2.1 + z * 5.3) * 0.5 + 0.5;
      let c: THREE.Color;
      if (noise > 0.55) c = landColor;
      else if (noise > 0.38) c = shallowColor;
      else c = oceanColor;
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      flatShading: true,
      shininess: 8,
    });

    this.sphere = new THREE.Mesh(geo, mat);
    this.sphere.receiveShadow = false;
    this.mesh.add(this.sphere);

    // Atmosphere glow ring (simple semi-transparent shell)
    const atmGeo = new THREE.IcosahedronGeometry(EARTH_RADIUS + 2, 1);
    const atmMat = new THREE.MeshPhongMaterial({
      color: 0x4499ff,
      flatShading: true,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
    });
    const atmMesh = new THREE.Mesh(atmGeo, atmMat);
    this.mesh.add(atmMesh);

    this.mesh.position.copy(EARTH_CENTER);
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
