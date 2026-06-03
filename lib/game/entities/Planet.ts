import * as THREE from 'three';
import { Body } from '../bodies';

/**
 * Renders any celestial {@link Body} as a low-poly sphere with a soft
 * atmosphere rim. Earth-likes get mottled land/ocean colouring; gas giants get
 * horizontal banding. The bright day-vs-dark-space feel of the sky is driven
 * by the Renderer's altitude gradient.
 */
export class Planet {
  mesh: THREE.Group;
  readonly body: Body;
  private surface: THREE.Mesh;

  constructor(scene: THREE.Scene, body: Body) {
    this.body = body;
    this.mesh = new THREE.Group();

    const detail = body.radius > 80 ? 3 : body.radius > 25 ? 2 : 1;
    const geo = new THREE.IcosahedronGeometry(body.radius, detail);
    const posAttr = geo.getAttribute('position');
    const colors: number[] = [];
    const base = new THREE.Color(body.color);
    const dark = base.clone().multiplyScalar(0.55);
    const light = base.clone().lerp(new THREE.Color(0xffffff), 0.28);
    const accent = body.gas
      ? base.clone().lerp(new THREE.Color(0x8a5a32), 0.4)
      : new THREE.Color(0x3fae6a); // greenery / maria

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
      let c: THREE.Color;
      if (body.gas) {
        // Latitude bands.
        const band = Math.sin((y / body.radius) * 9);
        c = band > 0.3 ? light : band < -0.3 ? dark : base;
      } else {
        const noise = Math.sin(x * 3.7 + y * 2.1 + z * 5.3) * 0.5 + 0.5;
        const noise2 = Math.sin(x * 1.3 - z * 2.7 + y * 0.7) * 0.5 + 0.5;
        if (noise > 0.62) c = light;
        else if (noise2 > 0.6 && body.id === 'earth') c = accent;
        else if (noise > 0.42) c = base;
        else c = dark;
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: body.gas ? 4 : 10 });
    this.surface = new THREE.Mesh(geo, mat);
    this.mesh.add(this.surface);

    // Atmosphere rim glow.
    if (body.atmosphereHeight > 0) {
      const visualAtmosphere = Math.max(10, body.atmosphereHeight * 0.35);
      const middleAtmosphere = Math.max(5, body.atmosphereHeight * 0.18);
      const rim = new THREE.Mesh(
        new THREE.IcosahedronGeometry(body.radius + visualAtmosphere, 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(body.skyDay),
          transparent: true,
          opacity: 0.09,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.mesh.add(rim);
      const middle = new THREE.Mesh(
        new THREE.IcosahedronGeometry(body.radius + middleAtmosphere, 2),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(body.skyDay).lerp(new THREE.Color(0xffffff), 0.25),
          transparent: true,
          opacity: 0.11,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.mesh.add(middle);
      const inner = new THREE.Mesh(
        new THREE.IcosahedronGeometry(body.radius + Math.max(2, body.atmosphereHeight * 0.05), 2),
        new THREE.MeshPhongMaterial({
          color: new THREE.Color(body.skyDay),
          transparent: true,
          opacity: 0.14,
          flatShading: true,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      this.mesh.add(inner);
    }

    this.mesh.position.copy(body.center);
    scene.add(this.mesh);
  }

  update(dt: number) {
    this.surface.rotation.y += 0.0015 * dt;
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
