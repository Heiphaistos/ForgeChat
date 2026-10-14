import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Service au premier plan des appels (modules/call-service) : sans les permissions et le type de
 * service, Android coupe le micro et la caméra dès que l'app passe en arrière-plan.
 */
const root = join(__dirname, '..', 'modules', 'call-service')
/** Fichiers lus en LF : les .kt peuvent être extraits en CRLF (core.autocrlf sous Windows). */
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

describe('modules/call-service', () => {
  it('déclare le service microphone|camera et ses permissions', () => {
    const manifest = read(join(root, 'android', 'src', 'main', 'AndroidManifest.xml'))
    for (const p of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'FOREGROUND_SERVICE_CAMERA']) {
      expect(manifest).toContain(`android.permission.${p}"`)
    }
    expect(manifest).toContain('android:foregroundServiceType="microphone|camera"')
    expect(manifest).toContain('android:exported="false"')
  })

  it('déclare le service « Notifications sans Google » (remoteMessaging) et ses commandes', () => {
    const manifest = read(join(root, 'android', 'src', 'main', 'AndroidManifest.xml'))
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING"')
    expect(manifest).toMatch(/KeepAliveService"\s+android:exported="false"\s+android:foregroundServiceType="remoteMessaging"/)
    const dir = join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice')
    const kt = read(join(dir, 'CallServiceModule.kt'))
    // Kotlin 2 : retour explicite `null` en fin de Function (sinon « Return type mismatch »).
    for (const f of ['startKeepAlive', 'stopKeepAlive']) {
      const body = kt.slice(kt.indexOf(`Function("${f}")`))
      expect(body.slice(0, body.indexOf('\n    }'))).toMatch(/\n {6}null$/)
    }
    const service = read(join(dir, 'KeepAliveService.kt'))
    expect(service).toContain('"ForgeChatNotifKeepAlive"')
    expect(service).toContain('FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING')
  })

  it("expose restart() (changement de thème) avec un retour explicite et l'arrêt du service", () => {
    const kt = read(join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice', 'CallServiceModule.kt'))
    const body = kt.slice(kt.indexOf('Function("restart")'))
    expect(body).toContain('Intent.makeRestartActivityTask')
    expect(body.indexOf('stopService')).toBeLessThan(body.indexOf('exit(0)'))
    expect(body).toMatch(/exit\(0\)\s*null/)
  })

  it('pilote la fenêtre des appels vidéo : plein écran immersif et image dans l’image', () => {
    const dir = join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice')
    const kt = read(join(dir, 'CallServiceModule.kt'))
    for (const f of ['setImmersive', 'setPip', 'enterPip']) {
      const body = kt.slice(kt.indexOf(`Function("${f}")`))
      expect(body.slice(0, body.indexOf('\n    }'))).toMatch(/\n {6}null$/)
    }
    expect(kt).toContain('Events("onPipChange", "onVolumeKey")')
    const win = read(join(dir, 'CallWindow.kt'))
    // Tout sur le fil UI ; entrée automatique Android 12+ ; ratio borné (sinon Android lève une exception).
    expect(win.match(/runOnUiThread/g)?.length).toBe(3)
    expect(win).toContain('setAutoEnterEnabled(enabled)')
    expect(win).toContain('coerceIn(0.42, 2.38)')
    expect(win).toContain('SCREEN_ORIENTATION_FULL_SENSOR')
  })

  it('voix et vidéo : porte de bruit, fond virtuel, touche volume, partage d’écran', () => {
    const dir = join(root, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'callservice')
    const kt = read(join(dir, 'CallServiceModule.kt'))
    for (const f of ['setNoiseGate', 'setVideoBackground', 'setVolumeKeys', 'importBackground']) expect(kt).toContain(`Function("${f}")`)
    expect(kt).toContain('OnCreate { BackgroundEffect.register() }')
    // Touche volume : fenêtre modifiée sur le fil UI seulement.
    expect(kt.slice(kt.indexOf('Function("setVolumeKeys")'))).toMatch(/^[^]*?runOnUiThread[^]*?VolumeKeys\.set/)
    const gradle = read(join(root, 'android', 'build.gradle'))
    expect(gradle).toContain("project(':livekit_react-native')")
    expect(gradle).toContain("project(':livekit_react-native-webrtc')")
    // Trame non traitée = null (la trame d'origine part) ; jamais la même trame renvoyée (double release).
    const bg = read(join(dir, 'BackgroundEffect.kt'))
    expect(bg).not.toMatch(/return frame\b/)
    expect(bg).toContain('src.release()')
    const gate = read(join(dir, 'NoiseGate.kt'))
    expect(gate).toContain('ByteOrder.nativeOrder()')
    expect(gate).toContain('broken = true')
    // Partage d'écran : permission déclarée, mais PAS de type mediaProjection sur le service d'appel.
    const manifest = read(join(root, 'android', 'src', 'main', 'AndroidManifest.xml'))
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"')
    expect(manifest).not.toMatch(/foregroundServiceType="[^"]*mediaProjection/)
  })

  it('est un module Expo Android lié automatiquement', () => {
    const config = JSON.parse(read(join(root, 'expo-module.config.json')))
    expect(config.android.modules).toEqual(['com.forgechat.callservice.CallServiceModule'])
  })
})
