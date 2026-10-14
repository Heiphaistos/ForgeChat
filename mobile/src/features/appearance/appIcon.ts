import { t } from '@/i18n'
import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'
import { saveAppearance, useAppearance } from '@/theme/prefs'
import { iconIdFromNative, nativeIconName, type AppIconId } from './appIconIds'

/**
 * Icône de l'application (Réglages → Apparence → Icône de l'app) : module natif modules/app-icon,
 * variantes déclarées au build par plugins/withAppIcons.js. Absent d'un build plus ancien : l'écran
 * l'indique au lieu de proposer les icônes.
 */
interface AppIconNative {
  isSupported(): Promise<boolean>
  getIcon(): Promise<string | null>
  setIcon(name: string | null): Promise<null>
}

const native = Platform.OS === 'android' || Platform.OS === 'ios' ? requireOptionalNativeModule<AppIconNative>('ForgeAppIcon') : null

export async function appIconSupported(): Promise<boolean> {
  try {
    return native ? await native.isSupported() : false
  } catch {
    return false
  }
}

/** Icône réellement active (le système fait foi : l'app a pu être réinstallée ou restaurée). */
export async function currentAppIcon(): Promise<AppIconId | null> {
  if (!native) return null
  const id = iconIdFromNative(await native.getIcon())
  saveAppearance({ appIcon: id })
  return id
}

/**
 * Applique l'icône (null = icône d'origine) et retient le choix sur cet appareil. Enregistré AVANT :
 * certains lanceurs Android ferment l'app dès le changement ; annulé si le système refuse.
 */
export async function applyAppIcon(id: AppIconId | null): Promise<void> {
  if (!native) throw new Error(t('sw.icon.unavailable'))
  const previous = useAppearance.getState().appIcon
  saveAppearance({ appIcon: id })
  try {
    await native.setIcon(nativeIconName(id))
  } catch (e) {
    saveAppearance({ appIcon: previous })
    throw e
  }
}
