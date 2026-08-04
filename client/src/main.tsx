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
// — prod uniquement pour ne pas gêner le HMR de dev
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

initFaviconAnimation()

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
