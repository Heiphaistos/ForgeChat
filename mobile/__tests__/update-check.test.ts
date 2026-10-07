import { compareVersions, fetchAvailableUpdate, isDue, parseManifest, parseVersion, shaMatches, CHECK_INTERVAL_MS } from '@/features/updates/updateCheck'
import type { UpdateNative } from '@/features/updates/installer'

/**
 * Vérification des mises à jour (manifeste publié par le serveur ForgeChat) : format des versions,
 * validation du manifeste, une seule requête anonyme, désactivable, au plus toutes les 3 h ;
 * téléchargement dans l'app avec vérification de l'empreinte avant d'ouvrir l'installeur Android.
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

  it('au plus toutes les 3 h (le processus reste vivant des jours : pas d’attente d’un démarrage à froid)', () => {
    expect(CHECK_INTERVAL_MS).toBe(3 * 3600_000)
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

describe('vérification automatique (démarrage et retour au premier plan)', () => {
  let env: { UPDATES_MANIFEST_URL: string | null; APP_VERSION: string }
  const mockDiscard = jest.fn()

  function load() {
    jest.resetModules()
    jest.doMock('react-native', () => ({ Alert: { alert: jest.fn() }, AppState: { addEventListener: jest.fn() } }))
    jest.doMock('@/lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn() } }))
    jest.doMock('@/config/env', () => env)
    jest.doMock('@/i18n', () => ({ t: (key: string) => key }))
    jest.doMock('@/features/updates/installer', () => ({ updateNative: { discardUpdate: mockDiscard }, resumeAfterPermission: jest.fn() }))
    const settings: Record<string, unknown> = { updateCheck: true, updateLastCheckAt: 0, updateSkippedVersion: null }
    settings.set = (patch: Record<string, unknown>) => Object.assign(settings, patch)
    jest.doMock('@/stores/settings', () => ({ useSettings: { getState: () => settings } }))
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mod = require('@/features/updates/useUpdateCheck') as typeof import('@/features/updates/useUpdateCheck')
    const store = require('@/features/updates/updateStore') as typeof import('@/features/updates/updateStore')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return { run: mod.runAutomaticUpdateCheck, settings, useUpdate: store.useUpdate }
  }

  beforeEach(() => {
    mockDiscard.mockClear()
    env = { UPDATES_MANIFEST_URL: MANIFEST, APP_VERSION: '1.0.0' }
  })

  it('affiche la bannière, puis ne revérifie qu’après 3 h', async () => {
    const { run, settings, useUpdate } = load()
    const fetchMock = jest.fn().mockResolvedValue(response(200, manifest()))
    const now = 1_800_000_000_000
    await expect(run(now, fetchMock)).resolves.toMatchObject({ version: '1.2.0' })
    expect(useUpdate.getState()).toMatchObject({ update: { version: '1.2.0', sha256: SHA }, phase: 'available', dismissed: false })
    expect(settings.updateLastCheckAt).toBe(now)
    await run(now + 3600_000, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await run(now + CHECK_INTERVAL_MS, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('« Plus tard » : la bannière revient à la vérification suivante', async () => {
    const { run, useUpdate } = load()
    const fetchMock = jest.fn().mockResolvedValue(response(200, manifest()))
    await run(1_000, fetchMock)
    useUpdate.setState({ dismissed: true })
    await run(1_000 + CHECK_INTERVAL_MS, fetchMock)
    expect(useUpdate.getState().dismissed).toBe(false)
  })

  it('échec réseau : ne consomme pas l’intervalle (nouvel essai au prochain retour)', async () => {
    const { run, settings } = load()
    await expect(run(5_000, jest.fn().mockRejectedValue(new Error('hors ligne')))).resolves.toBeNull()
    expect(settings.updateLastCheckAt).toBe(0)
    const fetchMock = jest.fn().mockResolvedValue(response(200, manifest()))
    await expect(run(6_000, fetchMock)).resolves.toMatchObject({ version: '1.2.0' })
  })

  it('à jour : l’APK resté dans le cache est supprimé', async () => {
    env = { UPDATES_MANIFEST_URL: MANIFEST, APP_VERSION: '1.2.0' }
    const { run, useUpdate } = load()
    await expect(run(Date.now(), jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
    expect(mockDiscard).toHaveBeenCalled()
    expect(useUpdate.getState().update).toBeNull()
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

  it('version ignorée : pas de bannière', async () => {
    const { run, settings, useUpdate } = load()
    settings.updateSkippedVersion = '1.2.0'
    await expect(run(Date.now(), jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
    expect(useUpdate.getState().update).toBeNull()
  })
})

describe('téléchargement et installation dans l’app', () => {
  const UPDATE = { version: '1.2.0', url: APK, sha256: SHA }

  function load() {
    jest.resetModules()
    jest.dontMock('@/features/updates/installer') // simulé par le bloc précédent
    jest.doMock('expo', () => ({ requireOptionalNativeModule: () => null }))
    jest.doMock('expo-linking', () => ({ openURL: jest.fn().mockResolvedValue(true) }))
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }))
    jest.doMock('@/lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn() } }))
    /* eslint-disable @typescript-eslint/no-require-imports */
    const installer = require('@/features/updates/installer') as typeof import('@/features/updates/installer')
    const { useUpdate, offerUpdate } = require('@/features/updates/updateStore') as typeof import('@/features/updates/updateStore')
    /* eslint-enable @typescript-eslint/no-require-imports */
    offerUpdate(UPDATE)
    return { startUpdate: installer.startUpdate, resumeAfterPermission: installer.resumeAfterPermission, useUpdate }
  }

  type Progress = (e: { received: number; total: number }) => void
  function fakeNative(downloadedSha: string, canInstall = true) {
    const listeners: Progress[] = []
    return {
      downloadUpdate: jest.fn(async (_url: string, _sha: string) => {
        listeners.forEach((fn) => fn({ received: 50, total: 100 }))
        return downloadedSha
      }),
      canInstallUpdate: jest.fn(() => canInstall),
      openInstallSettings: jest.fn(),
      installUpdate: jest.fn(() => true),
      discardUpdate: jest.fn(),
      addListener: jest.fn((_event: 'onUpdateProgress', fn: Progress) => {
        listeners.push(fn)
        return { remove: jest.fn() }
      }),
    } satisfies UpdateNative
  }

  it('compare les empreintes (casse ignorée, format strict)', () => {
    expect(shaMatches(SHA, SHA.toUpperCase())).toBe(true)
    expect(shaMatches(SHA, 'b'.repeat(64))).toBe(false)
    expect(shaMatches('', '')).toBe(false)
  })

  it('empreinte conforme : progression visible puis installeur Android', async () => {
    const { startUpdate, useUpdate } = load()
    const native = fakeNative(SHA)
    const seen: (number | null)[] = []
    const off = useUpdate.subscribe((s) => seen.push(s.progress))
    await startUpdate(native)
    off()
    expect(native.downloadUpdate).toHaveBeenCalledWith(APK, SHA)
    expect(seen).toContain(0.5)
    expect(native.installUpdate).toHaveBeenCalledTimes(1)
    expect(useUpdate.getState().phase).toBe('ready')
  })

  it('empreinte différente : fichier supprimé, JAMAIS installé', async () => {
    const { startUpdate, useUpdate } = load()
    const native = fakeNative('b'.repeat(64))
    await startUpdate(native)
    expect(native.discardUpdate).toHaveBeenCalled()
    expect(native.installUpdate).not.toHaveBeenCalled()
    expect(useUpdate.getState()).toMatchObject({ phase: 'error', error: 'sha' })
  })

  it('« sources inconnues » non autorisées : réglage ouvert, puis reprise au retour', async () => {
    const { startUpdate, resumeAfterPermission, useUpdate } = load()
    const native = fakeNative(SHA, false)
    await startUpdate(native)
    expect(native.openInstallSettings).toHaveBeenCalled()
    expect(native.installUpdate).not.toHaveBeenCalled()
    expect(useUpdate.getState().phase).toBe('permission')
    native.canInstallUpdate.mockReturnValue(true)
    resumeAfterPermission(native)
    expect(native.installUpdate).toHaveBeenCalledTimes(1)
    expect(useUpdate.getState().phase).toBe('ready')
  })

  it('échec du téléchargement : erreur réseau, réessayable', async () => {
    const { startUpdate, useUpdate } = load()
    const native = fakeNative(SHA)
    native.downloadUpdate.mockRejectedValueOnce(new Error('HTTP 503'))
    await startUpdate(native)
    expect(useUpdate.getState()).toMatchObject({ phase: 'error', error: 'network' })
    await startUpdate(native)
    expect(useUpdate.getState().phase).toBe('ready')
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
