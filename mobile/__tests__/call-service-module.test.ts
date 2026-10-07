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

  it('pilote la fenêtre des appels vidéo : plein écran immersif et image dans l’image', () => {
    const dir = join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice')
    const kt = readFileSync(join(dir, 'CallServiceModule.kt'), 'utf8')
    for (const f of ['setImmersive', 'setPip', 'enterPip']) {
      const body = kt.slice(kt.indexOf(`Function("${f}")`))
      expect(body.slice(0, body.indexOf('\n    }'))).toMatch(/\n {6}null$/)
    }
    expect(kt).toContain('Events("onUpdateProgress", "onPipChange", "onVolumeKey")')
    const win = readFileSync(join(dir, 'CallWindow.kt'), 'utf8')
    // Tout sur le fil UI ; entrée automatique Android 12+ ; ratio borné (sinon Android lève une exception).
    expect(win.match(/runOnUiThread/g)?.length).toBe(3)
    expect(win).toContain('setAutoEnterEnabled(enabled)')
    expect(win).toContain('coerceIn(0.42, 2.38)')
    expect(win).toContain('SCREEN_ORIENTATION_FULL_SENSOR')
  })

  it('voix et vidéo : porte de bruit, fond virtuel, touche volume, partage d’écran', () => {
    const dir = join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice')
    const kt = readFileSync(join(dir, 'CallServiceModule.kt'), 'utf8')
    for (const f of ['setNoiseGate', 'setVideoBackground', 'setVolumeKeys', 'importBackground']) expect(kt).toContain(`Function("${f}")`)
    expect(kt).toContain('OnCreate { BackgroundEffect.register() }')
    // Touche volume : fenêtre modifiée sur le fil UI seulement.
    expect(kt.slice(kt.indexOf('Function("setVolumeKeys")'))).toMatch(/^[^]*?runOnUiThread[^]*?VolumeKeys\.set/)
    const gradle = readFileSync(join(root, 'android', 'build.gradle'), 'utf8')
    expect(gradle).toContain("project(':livekit_react-native')")
    expect(gradle).toContain("project(':livekit_react-native-webrtc')")
    // Trame non traitée = null (la trame d'origine part) ; jamais la même trame renvoyée (double release).
    const bg = readFileSync(join(dir, 'BackgroundEffect.kt'), 'utf8')
    expect(bg).not.toMatch(/return frame\b/)
    expect(bg).toContain('src.release()')
    const gate = readFileSync(join(dir, 'NoiseGate.kt'), 'utf8')
    expect(gate).toContain('ByteOrder.nativeOrder()')
    expect(gate).toContain('broken = true')
    // Partage d'écran : permission déclarée, mais PAS de type mediaProjection sur le service d'appel.
    const manifest = readFileSync(join(root, 'android', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"')
    expect(manifest).not.toMatch(/foregroundServiceType="[^"]*mediaProjection/)
  })

  it('est un module Expo Android lié automatiquement', () => {
    const config = JSON.parse(readFileSync(join(root, 'expo-module.config.json'), 'utf8'))
    expect(config.android.modules).toEqual(['com.forgechat.callservice.CallServiceModule'])
  })
})
