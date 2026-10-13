import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import withAppIcons from '../plugins/withAppIcons.js'
import { APP_ICON_COUNT, APP_ICON_NUMBERS, iconIdFromNative, isAppIconId, nativeIconName, presetId, presetNumber } from '@/features/appearance/appIconIds'
import { PRESET_PREVIEWS } from '@/features/appearance/appIconPreviews'
import { parsePrefs } from '@/theme/prefs'

const root = join(__dirname, '..')

describe('identifiants des icônes de l’app', () => {
  it('mêmes identifiants que le web (preset:1 à preset:N), le reste est refusé', () => {
    expect(APP_ICON_COUNT).toBeGreaterThanOrEqual(150)
    expect(APP_ICON_NUMBERS).toHaveLength(APP_ICON_COUNT)
    expect(isAppIconId('preset:1')).toBe(true)
    expect(isAppIconId(`preset:${APP_ICON_COUNT}`)).toBe(true)
    for (const bad of ['preset:0', `preset:${APP_ICON_COUNT + 1}`, 'preset:1000', 'preset:07', 'preset:1x', 'custom', '', null, 3]) expect(isAppIconId(bad)).toBe(false)
    expect(presetNumber('preset:12')).toBe(12)
  })

  it('nom natif ↔ identifiant ; null = icône d’origine', () => {
    expect(nativeIconName(null)).toBeNull()
    expect(nativeIconName(presetId(7))).toBe('Preset7')
    expect(iconIdFromNative('Preset7')).toBe('preset:7')
    expect(iconIdFromNative(`Preset${APP_ICON_COUNT}`)).toBe(`preset:${APP_ICON_COUNT}`)
    for (const n of [null, undefined, '', 'Preset0', `Preset${APP_ICON_COUNT + 1}`, 'Preset1000', 'AppIcon', 4]) expect(iconIdFromNative(n)).toBeNull()
  })

  it('choix retenu dans les préférences d’apparence, invalide → icône d’origine', () => {
    expect(parsePrefs(JSON.stringify({ appIcon: 'preset:3' })).appIcon).toBe('preset:3')
    expect(parsePrefs(JSON.stringify({ appIcon: 'preset:999' })).appIcon).toBeNull()
    expect(parsePrefs(null).appIcon).toBeNull()
  })

  it('autant de variantes que le web, chacune avec ses sources et sa vignette', () => {
    const web = readFileSync(join(root, '..', 'client', 'src', 'lib', 'appIcon.ts'), 'utf8')
    expect(web).toContain(`PRESET_COUNT = ${APP_ICON_COUNT}`)
    const variants = withAppIcons.readVariants()
    expect(variants.map((v) => v.id)).toEqual(APP_ICON_NUMBERS.map(presetId))
    expect(variants.map((v) => v.name)).toEqual(APP_ICON_NUMBERS.map((n) => nativeIconName(presetId(n))))
    for (const n of APP_ICON_NUMBERS) {
      for (const f of [`preset-${n}.png`, `preset-${n}-foreground.png`, `preview/preset-${n}.png`]) {
        const png = readFileSync(join(root, 'assets', 'app-icons', f))
        // Plus grandes tailles finales : iOS 180 / Android 192 px, avant-plan adaptatif 108 dp × 4.
        const size = f.startsWith('preview') ? 144 : f.endsWith('foreground.png') ? 432 : 192
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size])
      }
      expect(PRESET_PREVIEWS[n]).toBeDefined()
    }
  })
})

describe('config plugin des icônes alternatives', () => {
  const variants = withAppIcons.readVariants().slice(0, 2)
  const manifest = () => ({
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [
        {
          $: { 'android:name': '.MainApplication' },
          activity: [
            {
              $: { 'android:name': '.MainActivity' },
              'intent-filter': [
                { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] },
                {
                  action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
                  category: [{ $: { 'android:name': 'android.intent.category.BROWSABLE' } }],
                  data: [{ $: { 'android:scheme': 'forgechat' } }],
                },
              ],
            },
          ],
        },
      ],
    },
  })

  it('Android : un alias désactivé par variante, entrée du lanceur et liens de MainActivity', () => {
    const out = withAppIcons.applyAndroidManifest(manifest() as never, variants)
    const app = out.manifest.application![0] as unknown as { activity: { 'intent-filter': unknown[] }[]; 'activity-alias': { $: Record<string, string>; 'intent-filter': { data?: unknown }[] }[] }
    // MainActivity reste l'entrée par défaut (icône d'origine), intacte.
    expect(app.activity[0]!['intent-filter']).toHaveLength(2)
    const aliases = app['activity-alias']
    expect(aliases.map((a) => a.$['android:name'])).toEqual(['.AppIconPreset1', '.AppIconPreset2'])
    for (const a of aliases) {
      expect(a.$).toMatchObject({ 'android:enabled': 'false', 'android:exported': 'true', 'android:targetActivity': '.MainActivity' })
      expect(JSON.stringify(a['intent-filter'][0])).toContain('android.intent.category.LAUNCHER')
      expect(JSON.stringify(a['intent-filter'][1])).toContain('forgechat')
    }
    expect(aliases[0]!.$['android:icon']).toBe('@mipmap/app_icon_preset1')
    // Idempotent (prebuild relancé sans --clean).
    const again = withAppIcons.applyAndroidManifest(out, variants).manifest.application![0] as unknown as { 'activity-alias': unknown[] }
    expect(again['activity-alias']).toHaveLength(2)
  })

  it('Android : fonds en couleur, dégradé, bandes ou disque', () => {
    expect(withAppIcons.backgroundDrawable({ type: 'solid', colors: ['#5865F2'] })).toContain('<solid android:color="#5865F2" />')
    expect(withAppIcons.backgroundDrawable({ type: 'gradient', colors: ['#5865F2', '#7C3AED'] })).toContain('android:angle="315"')
    const circle = withAppIcons.backgroundDrawable({ type: 'circle', colors: ['#5865F2', '#7C3AED'], base: '#1e1f22' })
    expect(circle).toContain('android:shape="oval"')
    expect(circle).toContain('#1e1f22')
    expect(withAppIcons.backgroundDrawable({ type: 'gradient', colors: ['#111111', '#222222', '#333333'] })).toContain('android:centerColor="#222222"')
    const flag = withAppIcons.backgroundDrawable({ type: 'stripes', colors: ['#FF0000', '#00FF00', '#0000FF'] })
    expect(flag).toContain('<item android:top="0dp"><shape><solid android:color="#FF0000" />')
    expect(flag).toContain('<item android:top="72dp"><shape><solid android:color="#0000FF" />')
    expect(withAppIcons.adaptiveIconXml('Preset1')).toContain('@mipmap/app_icon_preset1_foreground')
  })

  it('iOS : CFBundleAlternateIcons (iPhone et iPad), icône principale inchangée', () => {
    const plist = withAppIcons.applyInfoPlist({ CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon' } } }, variants) as Record<string, any>
    expect(plist.CFBundleIcons.CFBundlePrimaryIcon).toEqual({ CFBundleIconName: 'AppIcon' })
    expect(plist.CFBundleIcons.CFBundleAlternateIcons.Preset1).toEqual({ CFBundleIconFiles: ['AppIconPreset1'], UIPrerenderedIcon: false })
    expect(plist['CFBundleIcons~ipad'].CFBundleAlternateIcons.Preset2.CFBundleIconFiles).toEqual(['AppIconPreset2', 'AppIconPreset2-83.5'])
  })

  it('module natif : alias reconnus par leur préfixe, module déclaré pour Android et iOS', () => {
    const dir = join(root, 'modules', 'app-icon')
    const kt = readFileSync(join(dir, 'android', 'src', 'main', 'java', 'com', 'forgechat', 'appicon', 'AppIconModule.kt'), 'utf8')
    expect(kt).toContain('const val PREFIX = "AppIcon"')
    expect(kt).toContain('Name("ForgeAppIcon")')
    // Jamais zéro entrée dans le lanceur : la nouvelle est activée avant de désactiver les autres.
    expect(kt.indexOf('COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP')).toBeLessThan(kt.indexOf('COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP'))
    expect(readFileSync(join(dir, 'ios', 'ForgeAppIconModule.swift'), 'utf8')).toContain('setAlternateIconName')
    expect(JSON.parse(readFileSync(join(dir, 'expo-module.config.json'), 'utf8')).platforms).toEqual(['android', 'apple'])
    expect(existsSync(join(dir, 'ios', 'ForgeAppIcon.podspec'))).toBe(true)
  })
})
