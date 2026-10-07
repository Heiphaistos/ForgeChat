import { useQuery } from '@tanstack/react-query'
import { requireOptionalNativeModule } from 'expo'
import { useEffect } from 'react'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { useLang } from '@/i18n'
import { isHexColor } from '@/theme/palettes'
import { deviceCustom, saveAppearance, useAppearance, type AppearancePrefs } from '@/theme/prefs'
import { findTheme, sanitizeCustomList, type CustomTheme } from '@/theme/themeCore'

/** Réglages du compte (web) → préférences locales ; seuls les champs qui diffèrent sont rendus. */
export function serverAppearancePatch(s: Partial<ServerSideSettings>, local: AppearancePrefs): Partial<AppearancePrefs> {
  const patch: Partial<AppearancePrefs> = {}
  if (s.accent_color !== undefined) {
    const accent = isHexColor(s.accent_color) ? s.accent_color.toLowerCase() : null
    if (accent !== local.accent) patch.accent = accent
  }
  if (s.time_format === '12h' || s.time_format === '24h') {
    if (s.time_format !== local.timeFormat) patch.timeFormat = s.time_format
  }
  if (typeof s.streamer_mode === 'boolean' && s.streamer_mode !== local.streamerMode) patch.streamerMode = s.streamer_mode
  return patch
}

export const themeStudioKey = ['theme-studio'] as const

/** Thèmes perso du compte (créés sur le web ou le bureau), validés. */
export const accountCustomThemes = (data: { customs?: unknown } | null | undefined): CustomTheme[] => sanitizeCustomList(data?.customs)

/**
 * Thème du compte → préférences locales. Un thème perso (« c-… ») n'est retenu que si ses couleurs
 * sont connues ; elles sont copiées sur l'appareil (lues au démarrage, sans réseau).
 */
export function serverThemePatch(theme: string | null | undefined, customs: CustomTheme[], local: AppearancePrefs): Partial<AppearancePrefs> | null {
  if (!theme) return null
  if (theme.startsWith('c-')) {
    const found = customs.find((c) => c.id === theme)
    if (!found) return null
    const custom = deviceCustom(found)
    return theme !== local.theme || JSON.stringify(custom) !== JSON.stringify(local.custom) ? { theme, custom } : null
  }
  return findTheme(theme) && theme !== local.theme ? { theme, custom: null } : null
}

/**
 * Reprend l'accent, le format de l'heure, le mode streamer et la langue choisis sur le web. L'heure et le mode
 * streamer s'appliquent tout de suite, l'accent au prochain lancement (couleurs lues au démarrage).
 */
export function useAppearanceSync() {
  const { data } = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  const theme = useQuery({ queryKey: ['user-theme'], queryFn: settingsApi.theme })
  const studio = useQuery({ queryKey: themeStudioKey, queryFn: settingsApi.themeStudio })
  useEffect(() => {
    if (!data) return
    const patch = serverAppearancePatch(data, useAppearance.getState())
    if (Object.keys(patch).length) saveAppearance(patch)
    // Langue du compte : appliquée tout de suite (et mémorisée pour le prochain écran de connexion).
    if (data.language) useLang.getState().setLang(data.language)
  }, [data])
  // Thème choisi sur le web ou le bureau : appliqué au prochain lancement (couleurs lues au démarrage).
  useEffect(() => {
    const patch = serverThemePatch(theme.data?.theme, accountCustomThemes(studio.data), useAppearance.getState())
    if (patch) saveAppearance(patch)
  }, [theme.data, studio.data])
}

const nativeApp = requireOptionalNativeModule<{ restart(): void }>('ForgeCallService')

/** Redémarre l'app (Android, modules/call-service) ; false si impossible (iOS : l'utilisateur rouvre l'app). */
export function restartApp(): boolean {
  if (!nativeApp?.restart) return false
  nativeApp.restart()
  return true
}
