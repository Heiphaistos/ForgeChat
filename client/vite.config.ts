import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    // Émet /version.json à chaque build — le client le sonde pour détecter
    // qu'une nouvelle version est déployée et proposer un rechargement
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ version: pkg.version }),
        })
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/uploads': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules')) {
            if (id.includes('react-router-dom') || id.includes('react-dom') || id.includes('use-sync-external-store') || (id.includes('/react/') && !id.includes('@tanstack'))) return 'vendor-react'
            if (id.includes('@tanstack/react-query')) return 'vendor-query'
            if (id.includes('date-fns')) return 'vendor-dates'
            if (id.includes('highlight.js')) return 'vendor-hljs'
            if (id.includes('zustand') || id.includes('immer') || id.includes('axios') || id.includes('react-hot-toast') || id.includes('react-dropzone')) return 'vendor-misc'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
