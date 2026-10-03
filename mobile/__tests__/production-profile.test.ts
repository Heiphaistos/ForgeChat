import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Le client-apk (profil EAS « production ») ne doit contenir AUCUNE fonction de développement.
 * Ce test échoue si l'une d'elles apparaît dans la configuration du profil.
 */

const root = join(__dirname, '..')
const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

type Cfg = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Évalue app.config.ts avec l'environnement d'un profil EAS. */
function configFor(env: Record<string, string | undefined>): Cfg {
  const saved = { ...process.env }
  for (const k of ['APP_ENV', 'EXPO_PUBLIC_APP_ENV', 'FORGECHAT_API_URL', 'EAS_PROJECT_ID', 'GOOGLE_SERVICES_JSON']) delete process.env[k]
  Object.assign(process.env, env)
  try {
    let out: Cfg = {}
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../app.config')
      out = mod.default({ config: {}, projectRoot: root, staticConfigPath: null, packageJsonPath: null })
    })
    return out
  } finally {
    process.env = saved
  }
}

const plugin = (cfg: Cfg, name: string) =>
  (cfg.plugins as unknown[]).find((p) => (Array.isArray(p) ? p[0] : p) === name) as [string, Cfg] | string | undefined

describe('client-apk (profil EAS production)', () => {
  const profile = eas.build.production
  const cfg = configFor(profile.env)

  it('identité finale : package, nom, serveur de production', () => {
    expect(cfg.android.package).toBe('org.heiphaistos.forgechat')
    expect(cfg.name).toBe('ForgeChat')
    expect(profile.env.FORGECHAT_API_URL).toBe('https://forgechat.heiphaistos.org')
    expect(cfg.extra.apiUrl).toBe('https://forgechat.heiphaistos.org')
    expect(cfg.extra.appEnv).toBe('production')
    expect(cfg.icon).toBe('./assets/icon.png') // icône officielle, pas la variante DEV
  })

  it('pas de client de développement ni de mise à jour OTA', () => {
    expect(profile.developmentClient).toBeUndefined()
    expect(profile.distribution).not.toBe('internal')
    expect(plugin(cfg, 'expo-dev-client')).toBeUndefined()
    expect(pkg.dependencies['expo-updates']).toBeUndefined()
    expect(cfg.updates?.enabled ?? false).toBe(false)
    // expo-dev-client est exclu de l'autolinking sur le serveur de build (crochet EAS).
    expect(pkg.scripts['eas-build-pre-install']).toBe('node scripts/eas-build-pre-install.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { excludeDevClient } = require('../scripts/eas-build-pre-install.js')
    expect(excludeDevClient(pkg).expo.autolinking.exclude).toEqual(
      expect.arrayContaining(['expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu']),
    )
  })

  it('pas de trafic en clair, R8 actif, aucune URL non HTTPS', () => {
    const props = plugin(cfg, 'expo-build-properties') as [string, Cfg]
    expect(props[1].android.usesCleartextTraffic).toBe(false)
    expect(props[1].android.enableMinifyInReleaseBuilds).toBe(true)
    expect(cfg.extra.apiUrl.startsWith('https://')).toBe(true)
    // Aucune adresse http:// ni IP locale nulle part dans la configuration de la bêta.
    expect(JSON.stringify(cfg)).not.toMatch(/http:\/\/|10\.0\.2\.2|127\.0\.0\.1|192\.168\./)
    // Pas de plugin de trafic en clair LAN.
    expect(JSON.stringify(cfg)).not.toMatch(/network_security_config|cleartextTrafficPermitted/)
    expect(() => configFor({ ...profile.env, FORGECHAT_API_URL: 'http://forgechat.heiphaistos.org' })).toThrow(/https/)
  })

  it('outils de dev retirés du bundle : EXPO_PUBLIC_APP_ENV explicite en production', () => {
    expect(profile.env.EXPO_PUBLIC_APP_ENV).toBe('production')
    expect(() => configFor({ ...profile.env, EXPO_PUBLIC_APP_ENV: undefined })).toThrow(/EXPO_PUBLIC_APP_ENV/)
  })

  it('aucune permission de lecture de la galerie (sélecteur de photos du système)', () => {
    for (const p of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_EXTERNAL_STORAGE']) {
      expect(cfg.android.permissions).not.toContain(`android.permission.${p}`)
      expect(cfg.android.blockedPermissions).toContain(`android.permission.${p}`)
    }
    // Indispensable à expo-screen-capture sur Android 14+ : ne doit pas être bloquée.
    expect(cfg.android.blockedPermissions).not.toContain('android.permission.DETECT_SCREEN_CAPTURE')
  })

  it('AAB Play Store : même profil, seul le format change', () => {
    expect(eas.build.store).toEqual({ extends: 'production', android: { buildType: 'app-bundle' } })
    expect(profile.android.buildType).toBe('apk')
  })
})

describe('client-apk : code de développement exclu du bundle', () => {
  const { readdirSync, statSync } = jest.requireActual<typeof import('node:fs')>('node:fs')
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
    })
  const files = walk(join(root, 'src')).filter((f) => !f.includes(join('src', 'features', 'devtools')))

  it('aucun import statique des outils de dev (panneau, écran Serveur)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect({ f, hit: /^import[^\n]*features\/devtools/m.test(src) }).toEqual({ f, hit: false })
    }
  })

  it('chaque require des outils de dev est derrière la condition constante de production', () => {
    let count = 0
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/require\(['"]@\/features\/devtools/.test(line)) return
        count++
        const before = lines.slice(Math.max(0, i - 4), i + 1).join('\n')
        expect({ f, line: i + 1, guarded: /process\.env\.EXPO_PUBLIC_APP_ENV === 'production'\s*\?\s*null/.test(before) }).toEqual({
          f,
          line: i + 1,
          guarded: true,
        })
      })
    }
    expect(count).toBeGreaterThanOrEqual(3) // you.tsx (Infos dev), env.ts (choix du serveur), login.tsx (lien Serveur)
  })
})

describe('APK DEV (profil EAS preview)', () => {
  const profile = eas.build.preview

  it('identité et icône DEV, distribution interne', () => {
    const cfg = configFor(profile.env)
    expect(cfg.android.package).toBe('org.heiphaistos.forgechat.dev')
    expect(cfg.name).toBe('ForgeChat Dev')
    expect(cfg.icon).toBe('./assets/dev/icon.png')
    expect(profile.android.buildType).toBe('apk')
    expect(profile.distribution).toBe('internal')
  })

  it('pré-prod vide permise, jamais la prod par défaut', () => {
    expect(profile.env.FORGECHAT_API_URL).toBe('')
    expect(configFor(profile.env).extra.apiUrl).toBe('')
    const { FORGECHAT_API_URL: _unset, ...withoutUrl } = profile.env
    expect(configFor(withoutUrl).extra.apiUrl).toBe('')
    expect(configFor(withoutUrl).android.intentFilters).toEqual([])
  })

  it('pré-prod renseignée : HTTPS obligatoire, App Links vers son domaine', () => {
    const cfg = configFor({ ...profile.env, FORGECHAT_API_URL: 'https://preprod.example.org' })
    expect(cfg.extra.apiUrl).toBe('https://preprod.example.org')
    expect(JSON.stringify(cfg.android.intentFilters)).toContain('preprod.example.org')
    expect(() => configFor({ ...profile.env, FORGECHAT_API_URL: 'http://preprod.example.org' })).toThrow(/https/)
    expect(() => configFor({ ...profile.env, FORGECHAT_API_URL: 'https://preprod.REMPLACER.invalid' })).toThrow(/n'est pas renseignée/)
  })

  it('HTTP en clair autorisé au niveau OS dans ce profil seulement (contrôle applicatif : serverUrl.ts)', () => {
    const props = plugin(configFor(profile.env), 'expo-build-properties') as [string, Cfg]
    expect(props[1].android.usesCleartextTraffic).toBe(true)
  })

  it('EXPO_PUBLIC_APP_ENV doit correspondre à APP_ENV', () => {
    expect(() => configFor({ ...profile.env, EXPO_PUBLIC_APP_ENV: 'production' })).toThrow(/EXPO_PUBLIC_APP_ENV/)
  })
})

describe('push Android (FCM)', () => {
  const profile = eas.build.production
  const { mkdtempSync, writeFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs')
  const { tmpdir } = jest.requireActual<typeof import('node:os')>('node:os')

  it('google-services.json hors dépôt, passé par GOOGLE_SERVICES_JSON', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'fc-')), 'google-services.json')
    writeFileSync(file, '{}')
    expect(configFor({ ...profile.env, GOOGLE_SERVICES_JSON: file }).android.googleServicesFile).toBe(file)
    expect(configFor(profile.env).android.googleServicesFile).toBeUndefined()
    expect(() => configFor({ ...profile.env, GOOGLE_SERVICES_JSON: '/nulle-part/google-services.json' })).toThrow(/introuvable/)
  })

  it('jamais de google-services.json versionné', () => {
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/google-services\*\.json/)
  })
})

