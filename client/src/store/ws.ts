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
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/ws?token=${token}`)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const handlers = get().handlers.get(msg.type) ?? []
        handlers.forEach(h => h(msg))
      } catch {}
    }

    ws.onclose = () => {
      set({ socket: null })
      // Reconnexion automatique après 3s
      setTimeout(() => {
        const t = localStorage.getItem('access_token')
        if (t) get().connect(t)
      }, 3000)
    }

    // Heartbeat toutes les 30s
    const heartbeat = setInterval(() => {
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
