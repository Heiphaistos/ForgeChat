import { create } from 'zustand'
import api, { SERVER_URL } from '../api/client'

type WsHandler = (data: unknown) => void

interface WsState {
  socket: WebSocket | null
  handlers: Map<string, WsHandler[]>
  connect: () => Promise<void>
  disconnect: () => void
  send: (msg: object) => void
  on: (type: string, handler: WsHandler) => () => void
  subscribeChannel: (channelId: string) => void
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function fetchWsTicket(): Promise<string | null> {
  try {
    const { data } = await api.post('/auth/ws-ticket', {})
    return data.ticket as string
  } catch {
    return null
  }
}

export const useWs = create<WsState>((set, get) => ({
  socket: null,
  handlers: new Map(),

  connect: async () => {
    // Obtenir un ticket éphémère (30s TTL) pour ne pas exposer le JWT dans les logs nginx
    const ticket = await fetchWsTicket()
    if (!ticket) return

    const base = isTauri
      ? `wss://forgechat.heiphaistos.org`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    const wsUrl = `${base}/ws?ticket=${encodeURIComponent(ticket)}`

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
      // Reconnexion automatique après 3s avec un nouveau ticket
      reconnectTimeout = setTimeout(() => get().connect(), 3000)
    }

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
