import * as THREE from 'three';

// Earth surface radius in THREE units
export const EARTH_RADIUS = 63.71;
// Earth center sits below the launch origin
export const EARTH_CENTER = new THREE.Vector3(0, -EARTH_RADIUS, 0);

// Scale: 1 THREE unit ≈ 1 km
// Gravitational parameter µ = G*M scaled so surface gravity ≈ 0.00981 units/s² (9.81 m/s² with 1 unit = 1 km)
export const GM = 9.81e-3 * EARTH_RADIUS * EARTH_RADIUS; // km³/s²

// Kármán line: space begins 100 km above the surface (1 THREE unit = 1 km).
export const KARMAN_LINE = 100.0;

// Atmosphere thickness (units above surface where drag fades to 0).
// Kept below the Kármán line so orbits at 100 km+ are drag-free and stable.
export const ATMOSPHERE_HEIGHT = 70.0;
