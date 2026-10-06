import { compareVersions, fetchAvailableUpdate, isDue, parseLatestRelease, parseVersion, CHECK_INTERVAL_MS } from '@/features/updates/updateCheck'

/**
 * Vérification des mises à jour (releases GitHub) : format des versions, validation de la réponse,
 * une seule requête anonyme, désactivable et limitée à une fois par jour.
 */

const REPO = 'exemple/forgechat-releases'
const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.2.0',
  html_url: `https://github.com/${REPO}/releases/tag/v1.2.0`,
  draft: false,
  prerelease: false,
  assets: [{ browser_download_url: 'https://github.com/x/y/releases/download/v1.2.0/app.apk' }],
  ...over,
})
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

describe('réponse de GitHub', () => {
  it('accepte une release publiée de ce dépôt et renvoie sa page (pas l’APK)', () => {
    expect(parseLatestRelease(release(), REPO)).toEqual({ version: '1.2.0', url: `https://github.com/${REPO}/releases/tag/v1.2.0` })
  })

  it('refuse brouillon, pré-version, autre dépôt, numéro invalide, réponse vide', () => {
    expect(parseLatestRelease(release({ draft: true }), REPO)).toBeNull()
    expect(parseLatestRelease(release({ prerelease: true }), REPO)).toBeNull()
    expect(parseLatestRelease(release({ html_url: 'https://github.com/pirate/forgechat/releases/tag/v1.2.0' }), REPO)).toBeNull()
    expect(parseLatestRelease(release({ html_url: 'https://exemple.invalid/releases/tag/v1.2.0' }), REPO)).toBeNull()
    expect(parseLatestRelease(release({ html_url: `https://github.com/${REPO}/releases/x" onclick="` }), REPO)).toBeNull()
    expect(parseLatestRelease(release({ tag_name: 'nightly' }), REPO)).toBeNull()
    expect(parseLatestRelease(null, REPO)).toBeNull()
    expect(parseLatestRelease({ message: 'Not Found' }, REPO)).toBeNull()
  })

  it('une fois par jour au plus', () => {
    const now = 1_800_000_000_000
    expect(isDue(0, now)).toBe(true)
    expect(isDue(now - 1000, now)).toBe(false)
    expect(isDue(now - CHECK_INTERVAL_MS, now)).toBe(true)
    expect(isDue(now + 60_000, now)).toBe(true) // horloge reculée : on ne bloque pas indéfiniment
  })
})

describe('requête vers GitHub', () => {
  it('une seule requête GET anonyme vers l’API publique, sans corps ni identifiant', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(200, release()))
    await expect(fetchAvailableUpdate(REPO, '1.0.0', fetchMock)).resolves.toEqual({
      version: '1.2.0',
      url: `https://github.com/${REPO}/releases/tag/v1.2.0`,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://api.github.com/repos/${REPO}/releases/latest`)
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('omit')
    expect(init.body).toBeUndefined()
    expect(Object.keys(init.headers)).toEqual(['Accept'])
  })

  it('rien à proposer : même version, version plus ancienne, aucune release (404)', async () => {
    await expect(fetchAvailableUpdate(REPO, '1.2.0', jest.fn().mockResolvedValue(response(200, release())))).resolves.toBeNull()
    await expect(fetchAvailableUpdate(REPO, '2.0.0', jest.fn().mockResolvedValue(response(200, release())))).resolves.toBeNull()
    await expect(fetchAvailableUpdate(REPO, '1.0.0', jest.fn().mockResolvedValue(response(404)))).resolves.toBeNull()
  })

  it('erreur de GitHub (limite de requêtes…) : échec signalé à l’appelant', async () => {
    await expect(fetchAvailableUpdate(REPO, '1.0.0', jest.fn().mockResolvedValue(response(403)))).rejects.toThrow('403')
  })
})

describe('vérification automatique au démarrage', () => {
  const mockAlert = jest.fn()
  let env: { UPDATES_REPO: string | null; APP_VERSION: string }

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
    env = { UPDATES_REPO: REPO, APP_VERSION: '1.0.0' }
  })

  it('propose la nouvelle version, puis ne revérifie pas avant 24 h', async () => {
    const { run, settings } = load()
    const fetchMock = jest.fn().mockResolvedValue(response(200, release()))
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

  it('build sans dépôt de releases (APK DEV, développement) : aucune requête', async () => {
    env = { UPDATES_REPO: null, APP_VERSION: '1.0.0' }
    const { run } = load()
    const fetchMock = jest.fn()
    await run(Date.now(), fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('version ignorée : pas de proposition ; réseau en panne : silencieux', async () => {
    const { run, settings } = load()
    settings.updateSkippedVersion = '1.2.0'
    await expect(run(Date.now(), jest.fn().mockResolvedValue(response(200, release())))).resolves.toBeNull()
    settings.updateLastCheckAt = 0
    await expect(run(Date.now(), jest.fn().mockRejectedValue(new Error('hors ligne')))).resolves.toBeNull()
    expect(mockAlert).not.toHaveBeenCalled()
  })
})

describe('dépôt des releases fixé au build', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { updatesRepo } = require('../plugins/updatesRepo.js') as typeof import('../plugins/updatesRepo')

  it('seulement pour la bêta, au format propriétaire/dépôt', () => {
    expect(updatesRepo('production', 'exemple/forgechat-releases')).toBe('exemple/forgechat-releases')
    expect(updatesRepo('production', ' exemple/repo.android ')).toBe('exemple/repo.android')
    expect(updatesRepo('production', undefined)).toBeNull()
    expect(updatesRepo('preview', 'exemple/forgechat-releases')).toBeNull()
    expect(updatesRepo('development', 'exemple/forgechat-releases')).toBeNull()
  })

  it('refuse tout le reste', () => {
    for (const bad of ['exemple', 'exemple/a/b', 'https://github.com/exemple/x', '-x/y', 'x/..', 'x/y z', 'x/y?z']) {
      expect(() => updatesRepo('production', bad)).toThrow('FORGECHAT_UPDATES_REPO invalide')
    }
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
