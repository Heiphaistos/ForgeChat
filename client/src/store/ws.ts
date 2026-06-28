import { create } from 'zustand'
import api, { SERVER_URL } from '../api/client'

type WsHandler = (data: unknown) => void

interface WsState {
  socket: WebSocket | null
  _reconnectTimeout: ReturnType<typeof setTimeout> | null
  _heartbeatInterval: ReturnType<typeof setInterval> | null
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

export const useWs = create<WsState>((set, get) => ({
  socket: null,
  _reconnectTimeout: null,
  _heartbeatInterval: null,
  handlers: new Map(),
  _openCallbacks: new Set(),

  connect: async () => {
    // Obtenir un ticket éphémère (30s TTL) pour ne pas exposer le JWT dans les logs nginx
    const ticket = await fetchWsTicket()
    if (!ticket) return

    const base = isTauri
      ? `wss://forgechat.heiphaistos.org`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
    const wsUrl = `${base}/ws?ticket=${encodeURIComponent(ticket)}`

    const ws = new WebSocket(wsUrl)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const handlers = get().handlers.get(msg.type) ?? []
        handlers.forEach(h => h(msg))
      } catch {}
    }

    ws.onclose = () => {
      const { _heartbeatInterval } = get()
      if (_heartbeatInterval) clearInterval(_heartbeatInterval)
      // Reconnexion automatique après 3s avec un nouveau ticket
      const timeout = setTimeout(() => get().connect(), 3000)
      set({ socket: null, _heartbeatInterval: null, _reconnectTimeout: timeout })
    }

    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'HEARTBEAT' }))
      }
    }, 30_000)

    ws.onopen = () => {
      set({ socket: ws })
      // Notifier les listeners de reconnexion (ex: re-subscribe aux canaux)
      get()._openCallbacks.forEach(cb => cb())
    }
    set({ socket: ws, _heartbeatInterval: interval })
  },

  disconnect: () => {
    const { socket, _reconnectTimeout, _heartbeatInterval } = get()
    if (_reconnectTimeout) clearTimeout(_reconnectTimeout)
    if (_heartbeatInterval) clearInterval(_heartbeatInterval)
    socket?.close()
    set({ socket: null, _reconnectTimeout: null, _heartbeatInterval: null })
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
    // Pas de set() ici — les handlers n'ont pas besoin d'être réactifs
    // set() déclencherait des re-renders inutiles sur tous les abonnés

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
