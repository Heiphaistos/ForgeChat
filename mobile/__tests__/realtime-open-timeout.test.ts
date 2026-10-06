jest.mock('@/config/env', () => ({ wsUrl: () => 'wss://test/ws' }))
jest.mock('@/lib/http', () => ({ http: { post: jest.fn().mockResolvedValue({ ticket: 'abcdefghijklmnop' }) } }))
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }))

// Socket qui ne s'ouvre jamais et ne se ferme jamais (réseau qui revient) : cas réel sur l'émulateur.
const sockets: { close: jest.Mock }[] = []
;(globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: unknown = null
  onerror: unknown = null
  close = jest.fn()
  constructor() {
    sockets.push(this)
  }
}

import { realtime } from '@/lib/realtime'

test('une socket bloquée à l’ouverture est abandonnée puis remplacée', async () => {
  jest.useFakeTimers()
  realtime.start()
  await jest.advanceTimersByTimeAsync(0)
  expect(sockets).toHaveLength(1)
  await jest.advanceTimersByTimeAsync(15_000)
  expect(sockets[0].close).toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(2_000)
  expect(sockets).toHaveLength(2)
  realtime.stop()
  jest.useRealTimers()
})
