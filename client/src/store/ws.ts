import { create } from 'zustand'
import api, { SERVER_URL } from '../api/client'

type WsHandler = (data: unknown) => void

interface WsState {
  socket: WebSocket | null
  connected: boolean
  _reconnectTimeout: ReturnType<typeof setTimeout> | null
  _heartbeatInterval: ReturnType<typeof setInterval> | null
  _reconnectAttempts: number
  _connecting: boolean
  handlers: Map<string, WsHandler[]>
  _openCallbacks: Set<() => void>
  connect: () => Promise<void>
  disconnect: () => void
  send: (msg: object) => void
  on: (type: string, handler: WsHandler) => () => void
  onOpen: (cb: () => void) => () => void
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

function backoffDelay(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s → capped at 30s, with ±20% jitter to spread reconnects
  const base = Math.min(1000 * Math.pow(2, attempt), 30_000)
  return base * (0.8 + Math.random() * 0.4)
}

export const useWs = create<WsState>((set, get) => ({
  socket: null,
  connected: false,
  _reconnectTimeout: null,
  _heartbeatInterval: null,
  _reconnectAttempts: 0,
  _connecting: false,
  handlers: new Map(),
  _openCallbacks: new Set(),

  connect: async () => {
    const { socket, _connecting } = get()
    // Guard: avoid concurrent connect attempts
    if (_connecting) return
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return

    set({ _connecting: true })

    const ticket = await fetchWsTicket()
    if (!ticket) {
      const attempts = get()._reconnectAttempts
      const delay = backoffDelay(attempts)
      const timeout = setTimeout(() => get().connect(), delay)
      set({ _reconnectTimeout: timeout, _connecting: false, _reconnectAttempts: attempts + 1 })
      return
    }

    const base = isTauri
      ? `wss://forgechat.heiphaistos.org`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    const wsUrl = `${base}/ws?ticket=${encodeURIComponent(ticket)}`

    const ws = new WebSocket(wsUrl)
    set({ _connecting: false })

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const handlers = get().handlers.get(msg.type) ?? []
        handlers.forEach(h => h(msg))
      } catch {}
    }

    ws.onerror = () => {
      // l'événement close suit toujours, reconnect géré là-bas
    }

    ws.onclose = () => {
      const { _heartbeatInterval, _reconnectAttempts } = get()
      if (_heartbeatInterval) clearInterval(_heartbeatInterval)
      const delay = backoffDelay(_reconnectAttempts)
      const timeout = setTimeout(() => get().connect(), delay)
      set({ socket: null, connected: false, _heartbeatInterval: null, _reconnectTimeout: timeout, _reconnectAttempts: _reconnectAttempts + 1 })
    }

    ws.onopen = () => {
      const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'HEARTBEAT' }))
        }
      }, 30_000)
      set({ socket: ws, connected: true, _reconnectAttempts: 0, _heartbeatInterval: interval })
      get()._openCallbacks.forEach(cb => cb())
    }
    set({ socket: ws })
  },

  disconnect: () => {
    const { socket, _reconnectTimeout, _heartbeatInterval } = get()
    if (_reconnectTimeout) clearTimeout(_reconnectTimeout)
    if (_heartbeatInterval) clearInterval(_heartbeatInterval)
    socket?.close()
    set({ socket: null, connected: false, _reconnectTimeout: null, _heartbeatInterval: null, _reconnectAttempts: 0, _connecting: false })
  },

  send: (msg) => {
    const { socket } = get()
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  },

  on: (type, handler) => {
    const handlers = get().handlers
    const existing = handlers.get(type) ?? []
    handlers.set(type, [...existing, handler])

    return () => {
      const current = get().handlers.get(type) ?? []
      get().handlers.set(type, current.filter(h => h !== handler))
    }
  },

  onOpen: (cb) => {
    get()._openCallbacks.add(cb)
    return () => { get()._openCallbacks.delete(cb) }
  },

  subscribeChannel: (channelId) => {
    get().send({ type: 'SUBSCRIBE_CHANNEL', channel_id: channelId })
  },
}))
