// Serveur de dev pour les tests navigateur (scripts/admin.ui.playwright.mjs) : le client sur 5199,
// l'API et le WebSocket d'une instance locale (E2E_API, 58081 par défaut).
import { mergeConfig } from 'vite'
import base from './vite.config'

const api = process.env.E2E_API ?? 'http://127.0.0.1:58081'
export default mergeConfig(base, {
  server: { port: 5199, strictPort: true, proxy: { '/api': api, '/uploads': api, '/ws': { target: api.replace(/^http/, 'ws'), ws: true } } },
})
