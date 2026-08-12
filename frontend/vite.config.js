import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  build: {
    // The three.js runtime is lazy-loaded only on WebGL-capable devices and is
    // intentionally kept in its own cacheable chunk.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Vite 8's Rolldown adapter accepts the Rollup function form here.
        // Keep the WebGL runtime isolated without relying on the removed
        // object-form manualChunks configuration.
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/@react-three/fiber')) {
            return 'three'
          }
        },
      },
    },
  },
})
