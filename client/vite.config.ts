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
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-ui': [
            '@radix-ui/react-avatar',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-separator',
            '@radix-ui/react-tooltip',
          ],
          'vendor-motion': ['framer-motion'],
          'vendor-dates': ['date-fns'],
          'vendor-emoji': ['emoji-picker-react'],
          'vendor-hljs': ['highlight.js'],
          'vendor-misc': ['zustand', 'immer', 'axios', 'react-hot-toast', 'react-virtuoso', 'react-dropzone'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
})
