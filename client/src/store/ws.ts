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

// File d'émission utilisée quand la socket n'est pas ouverte (cf. send()).
interface Queued { msg: object; at: number }
const _outbox: Queued[] = []

let _lastAck = 0

// Un signal WebRTC périmé est pire qu'aucun signal : on jette ce qui a dépassé
// sa fenêtre utile au lieu de le rejouer à la reconnexion.
const MAX_AGE: Record<string, number> = {
  VOICE_STATE: 10_000,
  TYPING_START: 3_000,
}

function flushOutbox(socket: WebSocket) {
  const now = Date.now()
  const pending = _outbox.splice(0, _outbox.length)
  for (const { msg, at } of pending) {
    const type = (msg as any)?.type
    const maxAge = MAX_AGE[type] ?? 30_000
    if (now - at > maxAge) continue
    try { socket.send(JSON.stringify(msg)) } catch { /* socket refermée entre-temps */ }
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
      let msg: any
      try {
        msg = JSON.parse(e.data)
      } catch (err) {
        console.error('[ws] message JSON invalide', err)
        return
      }
      // Chaque handler isolé dans son propre try/catch : un handler qui plante ne doit
      // ni bloquer silencieusement les suivants (forEach s'arrêterait net) ni disparaître
      // sans trace — avant, tout le dispatch était dans un seul catch {} muet.
      // Le serveur répond HEARTBEAT_ACK ; sans surveiller ces accusés, une socket
      // « half-open » (NAT/proxy qui oublie le flux sans FIN) n'était jamais
      // détectée : l'utilisateur restait « en vocal » alors que plus rien
      // n'arrivait.
      if (msg.type === 'HEARTBEAT_ACK') { _lastAck = Date.now() }
      const handlers = get().handlers.get(msg.type) ?? []
      handlers.forEach(h => {
        try { h(msg) } catch (err) { console.error(`[ws] handler "${msg.type}" a levé`, err) }
      })
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
      _lastAck = Date.now()
      const interval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        // Deux battements sans accusé = socket morte côté réseau : on ferme pour
        // déclencher la reconnexion au lieu d'attendre indéfiniment.
        if (Date.now() - _lastAck > 75_000) {
          console.warn('[ws] aucun HEARTBEAT_ACK depuis 75 s, reconnexion forcée')
          ws.close()
          return
        }
        ws.send(JSON.stringify({ type: 'HEARTBEAT' }))
      }, 30_000)
      set({ socket: ws, connected: true, _reconnectAttempts: 0, _heartbeatInterval: interval })
      flushOutbox(ws)
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
      return
    }
    // Hors ligne : mettre en file plutôt que de jeter en silence. Un candidat ICE
    // ou une answer perdus pendant une micro-coupure WS = appel qui ne s'établit
    // jamais, sans la moindre trace.
    _outbox.push({ msg, at: Date.now() })
    if (_outbox.length > 200) _outbox.splice(0, _outbox.length - 200)
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
