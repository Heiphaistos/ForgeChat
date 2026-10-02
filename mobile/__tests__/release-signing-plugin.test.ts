import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import withReleaseSigning from '../plugins/withReleaseSigning.js'

// Extrait du build.gradle généré par le prebuild Expo (SDK 57).
const GRADLE = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }`

describe('withReleaseSigning', () => {
  const out = withReleaseSigning.applyReleaseSigning(GRADLE)

  it('la release n’est plus jamais signée avec la clé debug', () => {
    const release = out.slice(out.indexOf('        release {\n            // Caution'))
    expect(release).not.toMatch(/signingConfig signingConfigs\.debug/)
    expect(release).toContain("signingConfig System.getenv('FORGECHAT_KEYSTORE') ? signingConfigs.release : null")
    // Le build debug garde la clé debug.
    expect(out).toMatch(/debug \{\n\s+signingConfig signingConfigs\.debug/)
  })

  it('clé lue dans l’environnement : aucun chemin ni mot de passe en clair', () => {
    expect(out).toContain("file(System.getenv('FORGECHAT_KEYSTORE'))")
    expect(out).toContain("System.getenv('FORGECHAT_KEYSTORE_PASSWORD_FILE')")
    expect(out).not.toMatch(/\/home\/|\.config\/forgechat/)
  })

  it('idempotent, et échoue si le gabarit change', () => {
    expect(withReleaseSigning.applyReleaseSigning(out)).toBe(out)
    expect(() => withReleaseSigning.applyReleaseSigning('android {}')).toThrow(/introuvable/)
  })

  it('aucun keystore ni mot de passe dans le dépôt mobile', () => {
    const gitignore = readFileSync(join(__dirname, '..', '..', '.gitignore'), 'utf8') + readFileSync(join(__dirname, '..', '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/\*\.keystore|\*\.jks/)
  })
})
