'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Body } from '@/lib/game/bodies';
import { Planet } from '@/lib/game/entities/Planet';

type PlanetCanvasProps = {
  body: Body;
};

export function PlanetCanvas({ body }: PlanetCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 200;
    const height = container.clientHeight || 200;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // Setup camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Position camera far enough to view the whole body radius
    camera.position.set(0, body.radius * 0.4, body.radius * 2.5);
    camera.lookAt(0, 0, 0);

    // Setup basic lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(5, 10, 7).normalize();
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x90b0ff, 0.5);
    dirLight2.position.set(-5, -5, -5).normalize();
    scene.add(dirLight2);

    // We need to pass a body cloned or moved to center (0, 0, 0)
    const clonedBody = { ...body, center: new THREE.Vector3(0, 0, 0) };
    const planet = new Planet(scene, clonedBody);

    let animationFrameId: number;
    let lastTime = performance.now();

    const animate = () => {
      const time = performance.now();
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      planet.update(dt * 60); // multiply by 60 because update expects units relative to 60fps
      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      planet.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [body]);

  return <div ref={containerRef} className="w-full h-full relative overflow-hidden" />;
}
