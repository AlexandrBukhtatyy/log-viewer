import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.{test,spec}.ts'],
    // The PWA plugin and React plugins are not needed for unit tests of pure
    // TS / Node-resolvable modules; tests that hit the browser worker boundary
    // belong to Playwright (already wired) rather than Vitest.
  },
});
