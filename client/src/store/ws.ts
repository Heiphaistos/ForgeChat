import { create } from 'zustand'

type WsHandler = (data: unknown) => void

interface WsState {
  socket: WebSocket | null
  handlers: Map<string, WsHandler[]>
  connect: (token: string) => void
  disconnect: () => void
  send: (msg: object) => void
  on: (type: string, handler: WsHandler) => () => void
  subscribeChannel: (channelId: string) => void
}

export const useWs = create<WsState>((set, get) => ({
  socket: null,
  handlers: new Map(),

  connect: (token: string) => {
    const isTauri = '__TAURI_INTERNALS__' in window
    // SÉCURITÉ: Le token passé en query param est visible dans les logs nginx.
    // Utiliser /api/auth/ws-ticket pour obtenir un ticket éphémère (30s TTL).
    const wsUrl = isTauri
      ? `wss://forgechat.heiphaistos.org/ws?token=${encodeURIComponent(token)}`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const handlers = get().handlers.get(msg.type) ?? []
        handlers.forEach(h => h(msg))
      } catch {}
    }

    ws.onclose = () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval)
      set({ socket: null })
      // Reconnexion automatique après 3s
      reconnectTimeout = setTimeout(() => {
        const t = localStorage.getItem('access_token')
        if (t) get().connect(t)
      }, 3000)
    }

    // Heartbeat toutes les 30s
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'HEARTBEAT' }))
      }
    }, 30_000)

    ws.onopen = () => set({ socket: ws })

    set({ socket: ws })
  },

  disconnect: () => {
    get().socket?.close()
    set({ socket: null })
  },

  send: (msg) => {
    const { socket } = get()
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  },

  on: (type, handler) => {
    const { handlers } = get()
    const existing = handlers.get(type) ?? []
    handlers.set(type, [...existing, handler])
    set({ handlers: new Map(handlers) })

    return () => {
      const current = get().handlers.get(type) ?? []
      get().handlers.set(type, current.filter(h => h !== handler))
    }
  },

  subscribeChannel: (channelId) => {
    get().send({ type: 'SUBSCRIBE_CHANNEL', channel_id: channelId })
  },
}))
