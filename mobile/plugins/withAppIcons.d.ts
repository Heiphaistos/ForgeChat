import type { AndroidConfig, ConfigPlugin } from '@expo/config-plugins'

interface Background {
  type: 'solid' | 'gradient' | 'circle'
  colors: string[]
  base?: string
}
interface Variant {
  id: string
  name: string
  background: Background
}

declare const withAppIcons: ConfigPlugin & {
  readVariants(file?: string): Variant[]
  applyAndroidManifest(manifest: AndroidConfig.Manifest.AndroidManifest, variants: Variant[]): AndroidConfig.Manifest.AndroidManifest
  applyInfoPlist(plist: Record<string, unknown>, variants: Variant[]): Record<string, unknown>
  backgroundDrawable(bg: Background): string
  adaptiveIconXml(name: string): string
}
export = withAppIcons
