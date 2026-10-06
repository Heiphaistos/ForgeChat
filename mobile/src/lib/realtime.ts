import { create } from 'zustand'
import { wsUrl } from '@/config/env'
import { http } from './http'
import { logger } from './logger'

/**
 * Client WebSocket temps réel.
 *
 * - Authentification par TICKET éphémère à usage unique (POST /auth/ws-ticket,
 *   TTL 30 s côté Redis) : le JWT n'apparaît jamais dans une URL (logs proxy).
 * - Heartbeat applicatif 25 s + watchdog : une socket « zombie » (fréquent sur
 *   mobile lors d'un changement de réseau) est détectée et recréée.
 * - Reconnexion exponentielle avec jitter.
 * - Taille et forme des messages entrants validées avant dispatch.
 */

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface RealtimeEvent {
  type: string
  [key: string]: unknown
}

type Handler = (event: RealtimeEvent) => void

export const useConnection = create<{ status: RealtimeStatus }>(() => ({ status: 'idle' }))

const HEARTBEAT_MS = 25_000
const WATCHDOG_MS = 70_000
/** Socket ni ouverte ni fermée après ce délai (réseau qui revient) : on la jette et on réessaie. */
const OPEN_TIMEOUT_MS = 15_000
const MAX_INBOUND_BYTES = 1_000_000
const MAX_OUTBOUND_BYTES = 60_000 // le serveur coupe au-delà de 64 Ko

function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000)
  return base * (0.8 + Math.random() * 0.4)
}

class RealtimeClient {
  private socket: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private anyHandlers = new Set<Handler>()
  private openHandlers = new Set<() => void>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private wanted = false
  private connecting = false
  private generation = 0

  get isOpen() {
    return this.socket?.readyState === WebSocket.OPEN
  }

  /** Démarre (ou maintient) la connexion. Idempotent. */
  start() {
    this.wanted = true
    if (this.socket || this.connecting) return
    void this.connect()
  }

  /** Ferme la connexion et désactive la reconnexion automatique. */
  stop() {
    this.wanted = false
    this.generation++
    this.clearTimers()
    const s = this.socket
    this.socket = null
    this.connecting = false
    if (s) {
      s.onclose = null
      s.onmessage = null
      s.onerror = null
      try {
        s.close(1000, 'client stop')
      } catch {
        /* déjà fermée */
      }
    }
    this.attempts = 0
    useConnection.setState({ status: 'closed' })
  }

  /** Force une reconnexion immédiate (retour au premier plan, réseau revenu…). */
  kick() {
    if (!this.wanted) return
    if (this.isOpen) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.attempts = 0
    if (!this.socket && !this.connecting) void this.connect()
  }

  send(message: RealtimeEvent | Record<string, unknown>): boolean {
    if (!this.isOpen || !this.socket) return false
    const payload = JSON.stringify(message)
    if (payload.length > MAX_OUTBOUND_BYTES) {
      logger.warn('ws', 'message sortant trop volumineux ignoré')
      return false
    }
    this.socket.send(payload)
    return true
  }

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }

  onAny(handler: Handler): () => void {
    this.anyHandlers.add(handler)
    return () => this.anyHandlers.delete(handler)
  }

  onOpen(handler: () => void): () => void {
    this.openHandlers.add(handler)
    return () => this.openHandlers.delete(handler)
  }

  private async connect() {
    this.connecting = true
    const gen = ++this.generation
    useConnection.setState({ status: this.attempts === 0 ? 'connecting' : 'reconnecting' })

    let ticket: string
    try {
      const res = await http.post<{ ticket: string }>('/auth/ws-ticket', {})
      if (typeof res?.ticket !== 'string' || !/^[A-Za-z0-9]{16,128}$/.test(res.ticket)) {
        throw new Error('ticket invalide')
      }
      ticket = res.ticket
    } catch (e) {
      this.connecting = false
      if (gen !== this.generation || !this.wanted) return
      logger.warn('ws', 'obtention du ticket impossible', e)
      this.scheduleReconnect()
      return
    }
    if (gen !== this.generation || !this.wanted) {
      this.connecting = false
      return
    }

    const ws = new WebSocket(`${wsUrl()}?ticket=${encodeURIComponent(ticket)}`)
    this.socket = ws
    this.connecting = false
    this.armWatchdog(OPEN_TIMEOUT_MS)

    ws.onopen = () => {
      if (gen !== this.generation) return
      this.attempts = 0
      useConnection.setState({ status: 'open' })
      this.heartbeat = setInterval(() => this.send({ type: 'HEARTBEAT' }), HEARTBEAT_MS)
      this.armWatchdog()
      this.openHandlers.forEach((h) => {
        try {
          h()
        } catch (e) {
          logger.error('ws', 'handler onOpen', e)
        }
      })
    }

    ws.onmessage = (e: WebSocketMessageEvent) => {
      if (gen !== this.generation) return
      this.armWatchdog()
      const raw = e.data
      if (typeof raw !== 'string' || raw.length > MAX_INBOUND_BYTES) return
      let event: unknown
      try {
        event = JSON.parse(raw)
      } catch {
        return
      }
      if (!event || typeof event !== 'object' || typeof (event as RealtimeEvent).type !== 'string') return
      this.dispatch(event as RealtimeEvent)
    }

    ws.onerror = () => {
      /* onclose suit toujours */
    }

    ws.onclose = () => {
      if (gen !== this.generation) return
      this.clearTimers()
      this.socket = null
      if (this.wanted) this.scheduleReconnect()
      else useConnection.setState({ status: 'closed' })
    }
  }

  private dispatch(event: RealtimeEvent) {
    const run = (h: Handler) => {
      try {
        h(event)
      } catch (err) {
        logger.error('ws', `handler "${event.type}"`, err)
      }
    }
    this.handlers.get(event.type)?.forEach(run)
    this.anyHandlers.forEach(run)
  }

  private armWatchdog(ms = WATCHDOG_MS) {
    if (this.watchdog) clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      logger.warn('ws', `aucun trafic depuis ${ms / 1000} s — reconnexion`)
      const s = this.socket
      this.socket = null
      this.clearTimers()
      try {
        s?.close()
      } catch {
        /* ignore */
      }
      if (this.wanted) this.scheduleReconnect()
    }, ms)
  }

  private scheduleReconnect() {
    useConnection.setState({ status: 'reconnecting' })
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    const delay = backoff(this.attempts++)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.wanted && !this.socket && !this.connecting) void this.connect()
    }, delay)
  }

  private clearTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.watchdog) clearTimeout(this.watchdog)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.heartbeat = null
    this.watchdog = null
    this.reconnectTimer = null
  }
}

export const realtime = new RealtimeClient()
