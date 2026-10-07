import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Service au premier plan des appels (modules/call-service) : sans les permissions et le type de
 * service, Android coupe le micro et la caméra dès que l'app passe en arrière-plan.
 */
const root = join(__dirname, '..', 'modules', 'call-service')

describe('modules/call-service', () => {
  it('déclare le service microphone|camera et ses permissions', () => {
    const manifest = readFileSync(join(root, 'android', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    for (const p of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_CAMERA']) {
      expect(manifest).toContain(`android.permission.${p}"`)
    }
    expect(manifest).toContain('android:foregroundServiceType="microphone|camera"')
    expect(manifest).toContain('android:exported="false"')
  })

  it('déclare le service « Notifications sans Google » (remoteMessaging) et ses commandes', () => {
    const manifest = readFileSync(join(root, 'android', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING"')
    expect(manifest).toMatch(/KeepAliveService"\s+android:exported="false"\s+android:foregroundServiceType="remoteMessaging"/)
    const dir = join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice')
    const kt = readFileSync(join(dir, 'CallServiceModule.kt'), 'utf8')
    // Kotlin 2 : retour explicite `null` en fin de Function (sinon « Return type mismatch »).
    for (const f of ['startKeepAlive', 'stopKeepAlive']) {
      const body = kt.slice(kt.indexOf(`Function("${f}")`))
      expect(body.slice(0, body.indexOf('\n    }'))).toMatch(/\n {6}null$/)
    }
    const service = readFileSync(join(dir, 'KeepAliveService.kt'), 'utf8')
    expect(service).toContain('"ForgeChatNotifKeepAlive"')
    expect(service).toContain('FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING')
  })

  it("expose restart() (changement de thème) avec un retour explicite et l'arrêt du service", () => {
    const kt = readFileSync(join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice', 'CallServiceModule.kt'), 'utf8')
    const body = kt.slice(kt.indexOf('Function("restart")'))
    expect(body).toContain('Intent.makeRestartActivityTask')
    expect(body.indexOf('stopService')).toBeLessThan(body.indexOf('exit(0)'))
    expect(body).toMatch(/exit\(0\)\s*null/)
  })

  it('est un module Expo Android lié automatiquement', () => {
    const config = JSON.parse(readFileSync(join(root, 'expo-module.config.json'), 'utf8'))
    expect(config.android.modules).toEqual(['com.forgechat.callservice.CallServiceModule'])
  })
})
