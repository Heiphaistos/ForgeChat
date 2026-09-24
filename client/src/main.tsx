// En premier : capte les erreurs dès l'évaluation des modules suivants.
import './lib/errorReporter'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'
import { initFaviconAnimation } from './faviconAnimator'

// Exporté pour permettre à des utilitaires hors-composant (ex. sendNativeNotification)
// de lire le cache sans avoir à traverser le contexte React.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
})

// Service worker : cache-first des assets hashés (chargements suivants instantanés)
// — prod uniquement pour ne pas gêner le HMR de dev.
//
// JAMAIS dans l'application bureau : sous WebView2 (origine http://tauri.localhost)
// les fetch() émis depuis un service worker ne passent pas par le protocole Tauri.
// Au 2e lancement le SW interceptait /assets/*, échouait, et la fenêtre restait
// vide (bug « fenêtre noire » des 3.22.0 et 3.24.0). On désinscrit aussi un SW
// éventuellement laissé par une version précédente.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  if (isTauri) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(r => r.unregister())))
      .then(() => caches?.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))))
      .catch(() => {})
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}

initFaviconAnimation()

// App de bureau Linux : signale le premier rendu. Sans ce signal, le lancement
// suivant passe tout seul en mode compatibilité (fenêtre blanche selon le GPU).
if (isTauri) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    import('@tauri-apps/api/core').then(m => m.invoke('app_ready')).catch(() => {})
  }))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="bottom-right" toastOptions={{
        style: { background: '#232428', color: '#dcddde', border: '1px solid #40444b' }
      }} />
    </QueryClientProvider>
  </React.StrictMode>
)
