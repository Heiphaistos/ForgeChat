import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
            if (id.includes('react-router-dom') || id.includes('react-dom') || (id.includes('/react/') && !id.includes('@tanstack'))) return 'vendor-react'
            if (id.includes('@tanstack/react-query')) return 'vendor-query'
            if (id.includes('@radix-ui')) return 'vendor-ui'
            if (id.includes('framer-motion')) return 'vendor-motion'
            if (id.includes('date-fns')) return 'vendor-dates'
            if (id.includes('emoji-picker-react')) return 'vendor-emoji'
            if (id.includes('highlight.js')) return 'vendor-hljs'
            if (id.includes('zustand') || id.includes('immer') || id.includes('axios') || id.includes('react-hot-toast') || id.includes('react-virtuoso') || id.includes('react-dropzone')) return 'vendor-misc'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
