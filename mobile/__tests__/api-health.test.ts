// 503 (le serveur refuse par sécurité, Redis indisponible) : jamais de déconnexion ni d'effacement
// des jetons ; GET retenté avec backoff, bandeau « Serveur momentanément indisponible ».
// 426 : code `update_required` et bandeau « Mets à jour ForgeChat ».
const mockSecure = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x',
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockSecure.set(k, v) },
  deleteItemAsync: async (k: string) => { mockSecure.delete(k) },
}))

import { ApiError, backoffMs, http, onSessionExpired, refreshAccessToken, useApiHealth } from '@/lib/http'
import { tokens } from '@/lib/tokens'

const reply = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response
const fetchMock = jest.fn()
// Minuteurs simulés : le backoff et la sonde de reprise ne retiennent pas le processus.
jest.useFakeTimers()
global.fetch = fetchMock as unknown as typeof fetch

beforeEach(async () => {
  fetchMock.mockReset()
  useApiHealth.setState({ unavailable: false, updateRequired: false })
  await tokens.setRefreshToken('refresh-1')
  tokens.setAccessToken(null)
})
afterAll(async () => {
  useApiHealth.setState({ unavailable: false })
  await tokens.clear()
})

test('backoff : 1 s, 2 s, 4 s… plafonné à 60 s', () => {
  expect([0, 1, 2, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 60_000])
})

test('refresh refusé en 503 : jetons gardés, aucune déconnexion, bandeau affiché', async () => {
  const expired = jest.fn()
  const off = onSessionExpired(expired)
  fetchMock.mockResolvedValue(reply(503, { error: 'Service momentanément indisponible' }))
  await expect(refreshAccessToken()).rejects.toMatchObject({ status: 503 })
  expect(await tokens.getRefreshToken()).toBe('refresh-1')
  expect(expired).not.toHaveBeenCalled()
  expect(useApiHealth.getState().unavailable).toBe(true)
  off()
})

test('GET en 503 : retenté après backoff, réussite = bandeau retiré', async () => {
  fetchMock.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(reply(200, { ok: 1 }))
  const p = http.get('/servers', { auth: false })
  await jest.advanceTimersByTimeAsync(1000)
  await expect(p).resolves.toEqual({ ok: 1 })
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(useApiHealth.getState().unavailable).toBe(false)
})

test('POST en 503 : pas renvoyé tout seul, erreur rendue, session intacte', async () => {
  fetchMock.mockResolvedValue(reply(503))
  await expect(http.post('/dms/x/messages', { enc: {} }, { auth: false })).rejects.toMatchObject({ status: 503 })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(await tokens.getRefreshToken()).toBe('refresh-1')
})

test('426 : code update_required et bandeau de mise à jour', async () => {
  fetchMock.mockResolvedValue(reply(426, { error: 'Mets à jour ForgeChat pour te connecter' }))
  const err = await http.post('/auth/login', {}, { auth: false }).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect((err as ApiError).code).toBe('update_required')
  expect((err as ApiError).message).toBe('Mets à jour ForgeChat pour te connecter')
  expect(useApiHealth.getState().updateRequired).toBe(true)
})

test('sonde de reprise : le bandeau disparaît dès que le serveur répond de nouveau', async () => {
  fetchMock.mockResolvedValueOnce(reply(503))
  await http.post('/x', {}, { auth: false }).catch(() => undefined)
  expect(useApiHealth.getState().unavailable).toBe(true)
  fetchMock.mockResolvedValue(reply(200, { access_token: 'a.b.c', refresh_token: 'refresh-2' }))
  await jest.advanceTimersByTimeAsync(4000)
  expect(useApiHealth.getState().unavailable).toBe(false)
})
