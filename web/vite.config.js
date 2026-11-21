import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    // Keep classic (max-width: …) media queries. The default minifier rewrites
    // them to range syntax (width<=899px), which older iOS Safari (< 16.4) and
    // older Android WebViews do not understand — that would silently drop the
    // whole mobile layout inside the Capacitor shells.
    cssTarget: ['chrome87', 'safari13', 'firefox78', 'edge88'],
  },
});
