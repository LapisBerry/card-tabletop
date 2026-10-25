import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the build works from any folder (for example GitHub Pages).
  base: './',
  build: {
    // Three.js alone is about 600 kB minified, so the default 500 kB warning always fires.
    chunkSizeWarningLimit: 900,
  },
});
