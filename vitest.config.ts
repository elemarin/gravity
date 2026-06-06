import { defineConfig } from 'vitest/config';

// The flight scenarios are deterministic, fixed-timestep simulations that run
// for many sim-seconds, so individual tests are CPU-heavy. We give them a long
// timeout and spread them across worker threads for parallelism.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    pool: 'threads',
    // Keep reporting readable for the large scenario matrix.
    reporters: process.env.CI ? ['dot'] : ['default'],
  },
});
