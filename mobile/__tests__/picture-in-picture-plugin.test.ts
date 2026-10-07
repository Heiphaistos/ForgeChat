import { applyPictureInPicture } from '../plugins/withPictureInPicture.js'

describe('config plugin de l’image dans l’image', () => {
  const manifest = (configChanges?: string) => ({
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity', ...(configChanges ? { 'android:configChanges': configChanges } : {}) },
              'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }],
            },
          ],
        },
      ],
    },
  })

  it('autorise le PiP sans recréer l’activité, en gardant les changements déjà déclarés', () => {
    const out = applyPictureInPicture(manifest('keyboard|keyboardHidden|orientation|screenSize|uiMode') as never)
    const activity = out.manifest.application![0]!.activity![0]!.$ as Record<string, string>
    expect(activity['android:supportsPictureInPicture']).toBe('true')
    const changes = activity['android:configChanges']!.split('|')
    for (const c of ['keyboard', 'uiMode', 'orientation', 'screenLayout', 'screenSize', 'smallestScreenSize']) expect(changes).toContain(c)
    expect(new Set(changes).size).toBe(changes.length)
  })

  it('fonctionne sans configChanges préalable', () => {
    const out = applyPictureInPicture(manifest() as never)
    expect((out.manifest.application![0]!.activity![0]!.$ as Record<string, string>)['android:configChanges']).toBe('orientation|screenLayout|screenSize|smallestScreenSize')
  })
})
