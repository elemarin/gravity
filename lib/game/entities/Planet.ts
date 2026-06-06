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

    // The Sun: a luminous, self-lit sphere with a soft corona — not a shaded world.
    if (body.star) {
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(body.radius, 4),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(body.color) }),
      );
      this.surface = core;
      this.mesh.add(core);
      for (const [scale, opacity] of [[1.18, 0.35], [1.45, 0.16], [1.9, 0.07]] as const) {
        this.mesh.add(new THREE.Mesh(
          new THREE.IcosahedronGeometry(body.radius * scale, 3),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(body.skyDay), transparent: true, opacity,
            side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
          }),
        ));
      }
      this.mesh.position.copy(body.center);
      scene.add(this.mesh);
      return;
    }

    const detail = body.radius > 80 ? 3 : body.radius > 25 ? 2 : 1;
    const geo = new THREE.IcosahedronGeometry(body.radius, detail);
    const posAttr = geo.getAttribute('position');
    const base = new THREE.Color(body.color);
    const dark = base.clone().multiplyScalar(0.55);
    const light = base.clone().lerp(new THREE.Color(0xffffff), 0.28);

    // Perturb vertices first for realistic terrains, mountains, and Phobos' potato shape!
    if (!body.gas && !body.star) {
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
        const normal = new THREE.Vector3(x, y, z).normalize();
        let rOffset = 0;
        
        // Multi-frequency noise for rocky/bumpy mountain and valley terrains
        const terrainNoise1 = Math.sin(x * 0.15 + y * 0.08 + z * 0.12);
        const terrainNoise2 = Math.sin(x * 0.45 - y * 0.32 + z * 0.25) * 0.35;
        rOffset += (terrainNoise1 + terrainNoise2) * (body.radius * 0.04);
        
        // Large scale deformation for Phobos potato-shape!
        if (body.id === 'phobos') {
          rOffset += (Math.sin(x * 0.3) * Math.cos(y * 0.2) + Math.sin(z * 0.4) * 0.5) * (body.radius * 0.18);
        }
        
        // Add craters to cratered bodies (moon, mercury, phobos, ceres)
        const isCratered = ['moon', 'mercury', 'phobos', 'ceres'].includes(body.id);
        if (isCratered) {
          // Fake low-poly craters by using sharp negative dips at specific locations
          const craterNoise = Math.sin(x * 0.5 + 1.2) * Math.cos(y * 0.5 - 0.5) * Math.sin(z * 0.5 + 2.3);
          if (craterNoise > 0.4) {
            const d = (craterNoise - 0.4) / 0.6; // 0 to 1
            const craterShape = -Math.sin(d * Math.PI) * 0.08 + (d > 0.8 ? 0.02 : 0);
            rOffset += craterShape * body.radius;
          }
        }
        
        const newR = body.radius + rOffset;
        posAttr.setXYZ(i, normal.x * newR, normal.y * newR, normal.z * newR);
      }
      posAttr.needsUpdate = true;
      geo.computeVertexNormals();
    }

    const colors: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
      let c = base.clone();
      
      if (body.gas) {
        // SWIRLY CLOUD BANDS FOR GAS GIANTS
        const wave = Math.sin(Math.atan2(z, x) * 6) * 0.12;
        const latPos = (y / body.radius) + wave;
        const band = Math.sin(latPos * 12);
        
        if (band > 0.45) {
          c.lerp(light, 0.4);
        } else if (band < -0.45) {
          c.lerp(dark, 0.45);
        } else {
          // Add secondary subtle bands
          const subBand = Math.sin(latPos * 32);
          if (subBand > 0.6) {
            c.lerp(light, 0.18);
          } else if (subBand < -0.6) {
            c.lerp(dark, 0.2);
          }
        }
        
        // Great Red Spot for Jupiter!
        if (body.id === 'jupiter') {
          const lat = y / body.radius;
          const angle = Math.atan2(z, x);
          const targetLat = -0.36;
          const targetAngle = 1.2;
          const latDiff = lat - targetLat;
          let angleDiff = angle - targetAngle;
          while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
          while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
          
          const d = (latDiff * latDiff) / (0.08 * 0.08) + (angleDiff * angleDiff) / (0.22 * 0.22);
          if (d < 1.0) {
            const spotColor = new THREE.Color(0xcc4425);
            c.lerp(spotColor, 1.0 - d);
          }
        }
      } else if (body.id === 'earth') {
        // DETAILED LOW-POLY EARTH BIOMES AND POLAR CAP
        const lat = Math.abs(y / body.radius);
        if (lat > 0.84) {
          c = new THREE.Color(0xffffff); // Polar Ice Cap
        } else {
          // elevation noise
          const heightNoise = Math.sin(x * 0.2 + y * 0.1 + z * 0.15) * 0.5 + 0.5;
          const detailNoise = Math.sin(x * 0.6 - y * 0.4 + z * 0.5) * 0.5 + 0.5;
          const elev = heightNoise * 0.7 + detailNoise * 0.3;
          
          if (elev < 0.42) {
            c = new THREE.Color(elev < 0.28 ? 0x163d70 : 0x225da3); // Ocean
          } else if (elev < 0.46) {
            c = new THREE.Color(0xdfc08a); // Beach
          } else if (elev < 0.68) {
            c = new THREE.Color(elev < 0.58 ? 0x318f4a : 0x226b34); // Grass/Forest
          } else if (elev < 0.82) {
            c = new THREE.Color(0x6e5c52); // Mountain rock
          } else {
            c = new THREE.Color(0xeeeeee); // Snow peak
          }
        }
      } else if (body.id === 'mars') {
        // DETAILED MARS SURFACE AND POLAR CAP
        const lat = Math.abs(y / body.radius);
        if (lat > 0.86) {
          c = new THREE.Color(0xf6f0f0); // North/South polar dry ice
        } else {
          const noise = Math.sin(x * 0.15 + y * 0.1 + z * 0.2) * 0.5 + 0.5;
          const noise2 = Math.sin(x * 0.4 - y * 0.3 + z * 0.3) * 0.5 + 0.5;
          const val = noise * 0.6 + noise2 * 0.4;
          if (val < 0.35) {
            c = new THREE.Color(0xb04c2c); // Dark volcanic planes
          } else if (val < 0.7) {
            c = new THREE.Color(0xd06a44); // Red deserts
          } else {
            c = new THREE.Color(0xe08b65); // Bright highlands/dust
          }
        }
      } else if (body.id === 'moon') {
        // DETAILED CRATERED MOON SURFACE
        const noise = Math.sin(x * 0.3 + y * 0.2 + z * 0.35) * 0.5 + 0.5;
        const noise2 = Math.sin(x * 0.8 - y * 0.5 + z * 0.7) * 0.5 + 0.5;
        const val = noise * 0.7 + noise2 * 0.3;
        if (val < 0.35) {
          c = new THREE.Color(0x8b8d99); // Dark lunar maria
        } else if (val < 0.75) {
          c = new THREE.Color(0xc2c7d2); // Normal lunar grey
        } else {
          c = new THREE.Color(0xe1e5f0); // Bright crater ejecta
        }
      } else if (body.id === 'mercury') {
        // DETAILED MERCURY SURFACE
        const noise = Math.sin(x * 0.3 + y * 0.2 + z * 0.35) * 0.5 + 0.5;
        const val = noise;
        if (val < 0.4) c = new THREE.Color(0x766e66);
        else if (val < 0.8) c = new THREE.Color(0x9c9088);
        else c = new THREE.Color(0xb8aba1);
      } else if (body.id === 'ceres') {
        // OCCATOR CRATER BRIGHT SPOT ON CERES
        const noise = Math.sin(x * 0.3 + y * 0.2 + z * 0.35) * 0.5 + 0.5;
        c = base.clone().lerp(dark, noise * 0.3);
        
        const lat = y / body.radius;
        const angle = Math.atan2(z, x);
        const latDiff = lat - 0.15;
        let angleDiff = angle - 0.8;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        const d = (latDiff * latDiff) / (0.05 * 0.05) + (angleDiff * angleDiff) / (0.05 * 0.05);
        if (d < 1.0) {
          c.lerp(new THREE.Color(0xffffff), 0.95);
        }
      } else if (body.id === 'titan') {
        // CLOUDY HAZY TITAN
        const noise = Math.sin((y / body.radius) * 6) * 0.5 + 0.5;
        c = base.clone().lerp(light, noise * 0.3);
      } else {
        // DEFAULT PLANETS (Venus, Uranus, Neptune, Phobos, etc.)
        const noise = Math.sin(x * 3.7 + y * 2.1 + z * 5.3) * 0.5 + 0.5;
        if (noise > 0.62) c = light;
        else if (noise > 0.42) c = base;
        else c = dark;
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // fog:false so a distant world stays visible when the camera is pulled all
    // the way back to frame the whole system (otherwise the fog fades it to black).
    const mat = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: body.gas ? 4 : 10, fog: false });
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
          fog: false,
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
          fog: false,
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

  /** Move the rendered world to its (orbiting) body's current position. */
  syncPosition() {
    this.mesh.position.copy(this.body.center);
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
