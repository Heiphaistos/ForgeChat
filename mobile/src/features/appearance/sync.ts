import { useQuery } from '@tanstack/react-query'
import { requireOptionalNativeModule } from 'expo'
import { useEffect } from 'react'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { useLang } from '@/i18n'
import { isHexColor, THEMES } from '@/theme/palettes'
import { saveAppearance, useAppearance, type AppearancePrefs } from '@/theme/prefs'

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

/**
 * Reprend l'accent, le format de l'heure, le mode streamer et la langue choisis sur le web. L'heure et le mode
 * streamer s'appliquent tout de suite, l'accent au prochain lancement (couleurs lues au démarrage).
 */
export function useAppearanceSync() {
  const { data } = useQuery({ queryKey: settingsKey, queryFn: settingsApi.get })
  const theme = useQuery({ queryKey: ['user-theme'], queryFn: settingsApi.theme })
  useEffect(() => {
    if (!data) return
    const patch = serverAppearancePatch(data, useAppearance.getState())
    if (Object.keys(patch).length) saveAppearance(patch)
    // Langue du compte : appliquée tout de suite (et mémorisée pour le prochain écran de connexion).
    if (data.language) useLang.getState().setLang(data.language)
  }, [data])
  // Thème choisi sur le web ou le bureau : appliqué au prochain lancement (couleurs lues au démarrage).
  useEffect(() => {
    const t = theme.data?.theme
    if (t && t !== useAppearance.getState().theme && THEMES.some((x) => x.id === t)) saveAppearance({ theme: t })
  }, [theme.data])
}

const nativeApp = requireOptionalNativeModule<{ restart(): void }>('ForgeCallService')

/** Redémarre l'app (Android, modules/call-service) ; false si impossible (iOS : l'utilisateur rouvre l'app). */
export function restartApp(): boolean {
  if (!nativeApp?.restart) return false
  nativeApp.restart()
  return true
}
