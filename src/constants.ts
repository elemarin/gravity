import * as THREE from 'three';

// Earth surface radius in THREE units
export const EARTH_RADIUS = 63.71;
// Earth center sits below the launch origin
export const EARTH_CENTER = new THREE.Vector3(0, -EARTH_RADIUS, 0);

// Scale: 1 THREE unit ≈ 1 km
// Gravitational parameter µ = G*M scaled so surface gravity ≈ 0.00981 units/s² (9.81 m/s² with 1 unit = 1 km)
export const GM = 9.81e-3 * EARTH_RADIUS * EARTH_RADIUS; // km³/s²

// Kármán line in THREE units (100 km above surface)
export const KARMAN_ALTITUDE = 10.0; // 10 THREE units = 100 km but we use 1 unit = 1 km so 100 units
// Recalibrate: 1 THREE unit = 1 km → Kármán = 100 THREE units above surface
export const KARMAN_LINE = 100.0;

// Atmosphere thickness (units above surface where drag fades to 0)
export const ATMOSPHERE_HEIGHT = 120.0;
