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

  it('est un module Expo Android lié automatiquement', () => {
    const config = JSON.parse(readFileSync(join(root, 'expo-module.config.json'), 'utf8'))
    expect(config.android.modules).toEqual(['com.forgechat.callservice.CallServiceModule'])
  })
})
