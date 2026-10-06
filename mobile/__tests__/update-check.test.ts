import { compareVersions, fetchAvailableUpdate, isDue, parseManifest, parseVersion, CHECK_INTERVAL_MS } from '@/features/updates/updateCheck'

/**
 * Vérification des mises à jour (manifeste publié par le serveur ForgeChat) : format des versions,
 * validation du manifeste, une seule requête anonyme, désactivable et limitée à une fois par jour.
 */

const MANIFEST = 'https://chat.exemple.org/desktop/mobile.json'
const SHA = 'a'.repeat(64)
const manifest = (android: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  version: '1.2.0',
  platforms: { android: { url: 'ForgeChat-1.2.0.apk', sha256: SHA, ...android } },
  ...over,
})
const APK = 'https://chat.exemple.org/desktop/ForgeChat-1.2.0.apk'
const response = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

describe('versions', () => {
  it('lit X.Y.Z avec ou sans « v »', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v10.0.1')).toEqual([10, 0, 1])
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('1.2.3-beta')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })

  it('compare numériquement (1.10.0 > 1.9.0)', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('n/importe', '1.0.0')).toBe(0)
  })
})

describe('manifeste du serveur', () => {
  it('accepte un APK du même serveur (URL relative ou absolue)', () => {
    expect(parseManifest(manifest(), MANIFEST)).toEqual({ version: '1.2.0', url: APK, sha256: SHA })
    expect(parseManifest(manifest({ url: APK }), MANIFEST)).toEqual({ version: '1.2.0', url: APK, sha256: SHA })
  })

  it('refuse autre hôte, HTTP, hors /desktop/, pas un .apk, empreinte invalide, numéro invalide', () => {
    expect(parseManifest(manifest({ url: 'https://pirate.example/desktop/x.apk' }), MANIFEST)).toBeNull()
    expect(parseManifest(manifest({ url: 'http://chat.exemple.org/desktop/x.apk' }), MANIFEST)).toBeNull()
    expect(parseManifest(manifest({ url: '/uploads/x.apk' }), MANIFEST)).toBeNull()
    expect(parseManifest(manifest({ url: 'javascript:alert(1)' }), MANIFEST)).toBeNull()
    expect(parseManifest(manifest({ url: 'ForgeChat.exe' }), MANIFEST)).toBeNull()
    expect(parseManifest(manifest({ sha256: 'abc' }), MANIFEST)).toBeNull()
    expect(parseManifest(manifest({}, { version: 'nightly' }), MANIFEST)).toBeNull()
    expect(parseManifest({ version: '1.2.0', platforms: {} }, MANIFEST)).toBeNull()
    expect(parseManifest(null, MANIFEST)).toBeNull()
  })

  it('une fois par jour au plus', () => {
    const now = 1_800_000_000_000
    expect(isDue(0, now)).toBe(true)
    expect(isDue(now - 1000, now)).toBe(false)
    expect(isDue(now - CHECK_INTERVAL_MS, now)).toBe(true)
    expect(isDue(now + 60_000, now)).toBe(true) // horloge reculée : on ne bloque pas indéfiniment
  })
})

describe('requête vers le serveur', () => {
  it('une seule requête GET anonyme, sans corps ni identifiant', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, manifest()))
    await expect(fetchAvailableUpdate(MANIFEST, '1.0.0', fetchMock)).resolves.toEqual({ version: '1.2.0', url: APK, sha256: SHA })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(MANIFEST)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('omit')
    expect(init.body).toBeUndefined()
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('rien à proposer : même version, version plus ancienne, aucune publication (404)', async () => {
    await expect(fetchAvailableUpdate(MANIFEST, '1.2.0', jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
    await expect(fetchAvailableUpdate(MANIFEST, '2.0.0', jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
    await expect(fetchAvailableUpdate(MANIFEST, '1.0.0', jest.fn().mockResolvedValue(response(404)))).resolves.toBeNull()
  })

  it('erreur du serveur : échec signalé à l’appelant', async () => {
    await expect(fetchAvailableUpdate(MANIFEST, '1.0.0', jest.fn().mockResolvedValue(response(503)))).rejects.toThrow('503')
  })
})

describe('vérification automatique au démarrage', () => {
  const mockAlert = jest.fn()
  let env: { UPDATES_MANIFEST_URL: string | null; APP_VERSION: string }

  function load() {
    jest.resetModules()
    jest.doMock('react-native', () => ({ Alert: { alert: mockAlert } }))
    jest.doMock('expo-linking', () => ({ openURL: jest.fn().mockResolvedValue(true) }))
    jest.doMock('@/lib/logger', () => ({ logger: { debug: jest.fn() } }))
    jest.doMock('@/config/env', () => env)
    const settings: Record<string, unknown> = { updateCheck: true, updateLastCheckAt: 0, updateSkippedVersion: null }
    settings.set = (patch: Record<string, unknown>) => Object.assign(settings, patch)
    jest.doMock('@/stores/settings', () => ({ useSettings: { getState: () => settings } }))
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/features/updates/useUpdateCheck') as typeof import('@/features/updates/useUpdateCheck')
    return { run: mod.runAutomaticUpdateCheck, settings }
  }

  beforeEach(() => {
    mockAlert.mockClear()
    env = { UPDATES_MANIFEST_URL: MANIFEST, APP_VERSION: '1.0.0' }
  })

  it('propose la nouvelle version, puis ne revérifie pas avant 24 h', async () => {
    const { run, settings } = load()
    const fetchMock = jest.fn().mockResolvedValue(response(200, manifest()))
    const now = 1_800_000_000_000
    await expect(run(now, fetchMock)).resolves.toMatchObject({ version: '1.2.0' })
    expect(mockAlert).toHaveBeenCalledWith('Nouvelle version disponible', expect.stringContaining('1.2.0'), expect.any(Array))
    expect(settings.updateLastCheckAt).toBe(now)
    await run(now + 3600_000, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('désactivée par l’utilisateur : aucune requête', async () => {
    const { run, settings } = load()
    settings.updateCheck = false
    const fetchMock = jest.fn()
    await run(Date.now(), fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('build sans manifeste de mises à jour (APK DEV, développement) : aucune requête', async () => {
    env = { UPDATES_MANIFEST_URL: null, APP_VERSION: '1.0.0' }
    const { run } = load()
    const fetchMock = jest.fn()
    await run(Date.now(), fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('version ignorée : pas de proposition ; réseau en panne : silencieux', async () => {
    const { run, settings } = load()
    settings.updateSkippedVersion = '1.2.0'
    await expect(run(Date.now(), jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
    settings.updateLastCheckAt = 0
    await expect(run(Date.now(), jest.fn().mockRejectedValue(new Error('hors ligne')))).resolves.toBeNull()
    expect(mockAlert).not.toHaveBeenCalled()
  })
})

describe('versionCode Android', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { versionCodeOf } = require('../plugins/versionCode.js') as typeof import('../plugins/versionCode')

  it('augmente avec la version (mise à jour acceptée par Android)', () => {
    expect(versionCodeOf('1.0.0')).toBe(10000)
    expect(versionCodeOf('1.2.3')).toBe(10203)
    expect(versionCodeOf('1.10.0')).toBeGreaterThan(versionCodeOf('1.9.99'))
    expect(versionCodeOf('2.0.0')).toBeGreaterThan(versionCodeOf('1.99.99'))
  })

  it('refuse un format ambigu', () => {
    for (const bad of ['1.0', '1.100.0', '1.0.100', 'v1.0.0', '1.0.0-beta']) expect(() => versionCodeOf(bad)).toThrow('version invalide')
  })
})
