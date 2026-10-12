import { ed25519 } from '@noble/curves/ed25519.js'
import { checkSignedSums, compareVersions, fetchAvailableUpdate, isDue, parseManifest, parseVersion, shaMatches, CHECK_INTERVAL_MS } from '@/features/updates/updateCheck'

/**
 * Vérification des mises à jour (manifeste publié par le serveur ForgeChat) : format des versions,
 * validation du manifeste, requêtes anonymes, désactivable, au plus toutes les 3 h ; signature
 * Ed25519 de SHA256SUMS.txt vérifiée avant de proposer la mise à jour (le fichier lui-même est
 * téléchargé par le navigateur, hors de portée de l'app).
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

// Clé de TEST (graine fixe), jamais la clé de production.
const SK = new Uint8Array(32).fill(7)
const PUB = Buffer.from(ed25519.getPublicKey(SK)).toString('base64')
const SUMS = new TextEncoder().encode(`${SHA}  ForgeChat-1.2.0.apk\n${SHA} *ForgeChat-1.2.0.ipa\n`)
const sign = (bytes: Uint8Array) => Buffer.from(ed25519.sign(bytes, SK)).toString('base64')
const bytesResponse = (bytes: Uint8Array) =>
  ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) }) as Response
/** Serveur simulé : manifeste, liste d'empreintes et signature. */
const server = (body: unknown = manifest(), sums = SUMS, sig = sign(SUMS)) =>
  jest.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/desktop/mobile.json')) return response(200, body)
    if (String(input).endsWith('/desktop/mobile-v1.2.0.SHA256SUMS.txt')) return bytesResponse(sums)
    if (String(input).endsWith('/desktop/mobile-v1.2.0.SHA256SUMS.txt.sig')) return bytesResponse(new TextEncoder().encode(sig))
    return response(404)
  })

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

  it('iOS : lit l’IPA du manifeste, jamais l’APK', () => {
    const ipa = 'https://chat.exemple.org/desktop/ForgeChat-1.2.0.ipa'
    const both = { version: '1.2.0', platforms: { android: { url: APK, sha256: SHA }, ios: { url: ipa, sha256: SHA } } }
    expect(parseManifest(both, MANIFEST, 'ios')).toEqual({ version: '1.2.0', url: ipa, sha256: SHA })
    expect(parseManifest(both, MANIFEST)).toEqual({ version: '1.2.0', url: APK, sha256: SHA })
    expect(parseManifest({ ...both, platforms: { ios: { url: APK, sha256: SHA } } }, MANIFEST, 'ios')).toBeNull()
    expect(parseManifest({ ...both, platforms: { android: both.platforms.android } }, MANIFEST, 'ios')).toBeNull()
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
  it('requêtes GET anonymes (manifeste, liste signée, signature), sans corps ni identifiant', async () => {
    const fetchMock = server()
    await expect(fetchAvailableUpdate(MANIFEST, '1.0.0', fetchMock, 'android', PUB)).resolves.toEqual({ version: '1.2.0', url: APK, sha256: SHA })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      MANIFEST,
      'https://chat.exemple.org/desktop/mobile-v1.2.0.SHA256SUMS.txt',
      'https://chat.exemple.org/desktop/mobile-v1.2.0.SHA256SUMS.txt.sig',
    ])
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit & { headers: Record<string, string> }][]) {
      expect(init.method).toBe('GET')
      expect(init.credentials).toBe('omit')
      expect(init.body).toBeUndefined()
      expect(init.headers.Authorization).toBeUndefined()
    }
  })

  it('liste signée par une autre clé que celle embarquée : refus', async () => {
    await expect(fetchAvailableUpdate(MANIFEST, '1.0.0', server())).rejects.toThrow('signature')
  })

  it('liste signée absente (release non signée) : refus', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => (String(input) === MANIFEST ? response(200, manifest()) : response(404)))
    await expect(fetchAvailableUpdate(MANIFEST, '1.0.0', fetchMock, 'android', PUB)).rejects.toThrow('404')
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

  function load() {
    jest.resetModules()
    jest.doMock('react-native', () => ({ Alert: { alert: jest.fn() }, AppState: { addEventListener: jest.fn() } }))
    jest.doMock('@/lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn() } }))
    jest.doMock('@/config/env', () => env)
    jest.doMock('@/features/updates/releaseKey', () => ({ RELEASE_PUBLIC_KEY: PUB }))
    jest.doMock('@/i18n', () => ({ t: (key: string) => key }))
    const settings: Record<string, unknown> = { updateCheck: true, updateLastCheckAt: 0, updateSkippedVersion: null }
    settings.set = (patch: Record<string, unknown>) => Object.assign(settings, patch)
    jest.doMock('@/stores/settings', () => ({ useSettings: { getState: () => settings } }))
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mod = require('@/features/updates/useUpdateCheck') as typeof import('@/features/updates/useUpdateCheck')
    const store = require('@/features/updates/updateStore') as typeof import('@/features/updates/updateStore')
    /* eslint-enable @typescript-eslint/no-require-imports */
    return { run: mod.runAutomaticUpdateCheck, required: mod.updateFromRequired, settings, useUpdate: store.useUpdate }
  }

  beforeEach(() => {
    env = { UPDATES_MANIFEST_URL: MANIFEST, APP_VERSION: '1.0.0' }
  })

  it('426 : manifeste signé d’abord (bannière, même version ignorée), page /telecharger en repli', async () => {
    const { required, settings, useUpdate } = load()
    settings.updateSkippedVersion = '1.2.0'
    const fallback = jest.fn()
    await required(fallback, server())
    expect(useUpdate.getState()).toMatchObject({ update: { version: '1.2.0' }, dismissed: false })
    expect(fallback).not.toHaveBeenCalled()
    useUpdate.setState({ update: null })
    await required(fallback, server(manifest(), SUMS, sign(new Uint8Array([1]))))
    expect(useUpdate.getState().update).toBeNull()
    expect(fallback).toHaveBeenCalledTimes(1)
    await required(fallback, jest.fn().mockRejectedValue(new Error('hors ligne')))
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it('426 sans manifeste dans ce build : page /telecharger', async () => {
    env = { UPDATES_MANIFEST_URL: null, APP_VERSION: '1.0.0' }
    const { required } = load()
    const fallback = jest.fn()
    const fetchMock = jest.fn()
    await required(fallback, fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('affiche la bannière, puis ne revérifie qu’après 3 h', async () => {
    const { run, settings, useUpdate } = load()
    const fetchMock = server()
    const now = 1_800_000_000_000
    await expect(run(now, fetchMock)).resolves.toMatchObject({ version: '1.2.0' })
    expect(useUpdate.getState()).toMatchObject({ update: { version: '1.2.0', sha256: SHA }, phase: 'available', dismissed: false })
    expect(settings.updateLastCheckAt).toBe(now)
    await run(now + 3600_000, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await run(now + CHECK_INTERVAL_MS, fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('« Plus tard » : la bannière revient à la vérification suivante', async () => {
    const { run, useUpdate } = load()
    const fetchMock = server()
    await run(1_000, fetchMock)
    useUpdate.setState({ dismissed: true })
    await run(1_000 + CHECK_INTERVAL_MS, fetchMock)
    expect(useUpdate.getState().dismissed).toBe(false)
  })

  it('échec réseau : ne consomme pas l’intervalle (nouvel essai au prochain retour)', async () => {
    const { run, settings } = load()
    await expect(run(5_000, jest.fn().mockRejectedValue(new Error('hors ligne')))).resolves.toBeNull()
    expect(settings.updateLastCheckAt).toBe(0)
    await expect(run(6_000, server())).resolves.toMatchObject({ version: '1.2.0' })
  })

  it('à jour : pas de bannière', async () => {
    env = { UPDATES_MANIFEST_URL: MANIFEST, APP_VERSION: '1.2.0' }
    const { run, useUpdate } = load()
    await expect(run(Date.now(), jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
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

  it('signature invalide : pas de bannière, nouvel essai plus tard', async () => {
    const { run, settings, useUpdate } = load()
    await expect(run(7_000, server(manifest(), SUMS, sign(new Uint8Array([1]))))).resolves.toBeNull()
    expect(useUpdate.getState().update).toBeNull()
    expect(settings.updateLastCheckAt).toBe(0)
  })

  it('version ignorée : pas de bannière', async () => {
    const { run, settings, useUpdate } = load()
    settings.updateSkippedVersion = '1.2.0'
    await expect(run(Date.now(), jest.fn().mockResolvedValue(response(200, manifest())))).resolves.toBeNull()
    expect(useUpdate.getState().update).toBeNull()
  })
})

describe('liste d’empreintes signée', () => {
  const UPDATE = { version: '1.2.0', url: APK, sha256: SHA }

  it('signature valide et ligne signée identique : accepté', () => {
    expect(() => checkSignedSums(UPDATE, SUMS, sign(SUMS), PUB)).not.toThrow()
    const ipa = { ...UPDATE, url: 'https://chat.exemple.org/desktop/ForgeChat-1.2.0.ipa' }
    expect(() => checkSignedSums(ipa, SUMS, sign(SUMS), PUB)).not.toThrow()
  })

  it('liste falsifiée après signature, signature tronquée ou illisible : refus', () => {
    const forged = new TextEncoder().encode(`${'b'.repeat(64)}  ForgeChat-1.2.0.apk\n`)
    expect(() => checkSignedSums({ ...UPDATE, sha256: 'b'.repeat(64) }, forged, sign(SUMS), PUB)).toThrow('signature')
    for (const bad of ['', 'AAAA', 'pas du base64 !', sign(SUMS).slice(0, 40)]) {
      expect(() => checkSignedSums(UPDATE, SUMS, bad, PUB)).toThrow('signature')
    }
  })

  it('APK absent de la liste signée, ou empreinte du manifeste différente : refus', () => {
    const other = new TextEncoder().encode(`${SHA}  ForgeChat-9.9.9.apk\n`)
    expect(() => checkSignedSums(UPDATE, other, sign(other), PUB)).toThrow('absent de la liste signée')
    expect(() => checkSignedSums({ ...UPDATE, sha256: 'c'.repeat(64) }, SUMS, sign(SUMS), PUB)).toThrow('empreinte différente')
  })

  it('nom de fichier sans la version annoncée (ancienne release resservie) : refus', () => {
    const old = { ...UPDATE, url: 'https://chat.exemple.org/desktop/ForgeChat-1.1.0.apk' }
    expect(() => checkSignedSums(old, SUMS, sign(SUMS), PUB)).toThrow('nom de fichier inattendu')
  })
})

describe('installation (navigateur, jamais depuis l’app)', () => {
  const UPDATE = { version: '1.2.0', url: APK, sha256: SHA }

  /** Fichier IPA simulé (module natif FileSystem) : `served` = octets envoyés par le serveur. */
  const fakeFs = (served: Uint8Array) => {
    const files = new Map<string, Uint8Array>()
    class FileSystemFile {
      constructor(readonly uri: string) {}
      get exists() { return files.has(this.uri) }
      delete() { files.delete(this.uri) }
      open() {
        const data = files.get(this.uri) ?? new Uint8Array(0)
        let pos = 0
        return { readBytes: (n: number) => { const b = data.subarray(pos, pos + n); pos += b.length; return b }, close: () => {} }
      }
    }
    return {
      files,
      fs: {
        FileSystemFile,
        cacheDirectory: 'file:///cache',
        downloadFileAsync: async (_url: string, to: { uri: string }) => { files.set(to.uri, served); return to.uri },
      },
    }
  }

  function load(os: 'android' | 'ios', openURL = jest.fn().mockResolvedValue(true), fs: unknown = null, share = jest.fn().mockResolvedValue({ action: 'sharedAction' })) {
    jest.resetModules()
    jest.dontMock('@/features/updates/installer') // simulé par le bloc précédent
    jest.doMock('expo-linking', () => ({ openURL }))
    jest.doMock('react-native', () => ({ Platform: { OS: os }, Share: { share } }))
    jest.doMock('expo-modules-core', () => ({ ...jest.requireActual('expo-modules-core'), requireOptionalNativeModule: () => fs }))
    /* eslint-disable @typescript-eslint/no-require-imports */
    const installer = require('@/features/updates/installer') as typeof import('@/features/updates/installer')
    const { useUpdate, offerUpdate } = require('@/features/updates/updateStore') as typeof import('@/features/updates/updateStore')
    /* eslint-enable @typescript-eslint/no-require-imports */
    offerUpdate(UPDATE)
    return { startUpdate: installer.startUpdate, useUpdate, openURL }
  }

  it('compare les empreintes (casse ignorée, format strict)', () => {
    expect(shaMatches(SHA, SHA.toUpperCase())).toBe(true)
    expect(shaMatches(SHA, 'b'.repeat(64))).toBe(false)
    expect(shaMatches('', '')).toBe(false)
  })

  it('Android : ouvre l’APK dans le navigateur (installeur du système, pas de sélecteur d’explorateurs)', async () => {
    const { startUpdate, useUpdate, openURL } = load('android')
    await startUpdate()
    expect(openURL).toHaveBeenCalledWith(APK)
    expect(useUpdate.getState().phase).toBe('ready')
  })

  it('Android : aucun navigateur → erreur, réessayable', async () => {
    const { startUpdate, useUpdate, openURL } = load('android', jest.fn().mockRejectedValueOnce(new Error('no')).mockResolvedValue(true))
    await startUpdate()
    expect(useUpdate.getState().phase).toBe('error')
    await startUpdate()
    expect(openURL).toHaveBeenCalledTimes(2)
    expect(useUpdate.getState().phase).toBe('ready')
  })

  it('iOS : IPA téléchargée et vérifiée ici, puis remise à AltStore/SideStore (jamais leur URL)', async () => {
    const ipa = new TextEncoder().encode('IPA signée')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sha = (require('crypto') as typeof import('crypto')).createHash('sha256').update(ipa).digest('hex')
    const { fs } = fakeFs(ipa)
    const share = jest.fn().mockResolvedValue({ action: 'sharedAction' })
    const { startUpdate, useUpdate, openURL } = load('ios', undefined, fs, share)
    useUpdate.setState({ update: { ...UPDATE, sha256: sha } })
    await startUpdate()
    expect(openURL).not.toHaveBeenCalled()
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: 'file:///cache/ForgeChat-1.2.0.ipa' }))
    expect(useUpdate.getState().phase).toBe('ready')
  })

  it('iOS : fichier différent de la version signée → refusé, rien remis à AltStore', async () => {
    const { fs, files } = fakeFs(new TextEncoder().encode('IPA piégée'))
    const share = jest.fn()
    const { startUpdate, useUpdate, openURL } = load('ios', undefined, fs, share)
    await startUpdate()
    expect(share).not.toHaveBeenCalled()
    expect(openURL).not.toHaveBeenCalled()
    expect(files.size).toBe(0)
    expect(useUpdate.getState().phase).toBe('invalid')
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
