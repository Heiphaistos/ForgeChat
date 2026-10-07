// WebView cachée du moteur d'IA sur l'appareil (bridge.ts) et bandeau de téléchargement
// des modèles. Montée seulement après la première demande (traduire, transcrire, réglages).
import { useCallback, useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { apiOrigin } from '@/config/env'
import { useT } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'
import { attach, onEngineMessage, useAiHost } from './bridge'

export default function AiEngineHost() {
  const t = useT()
  const active = useAiHost((s) => s.active)
  const progress = useAiHost((s) => s.progress)
  const web = useRef<WebView>(null)
  const page = `${apiOrigin()}/ai-engine.html`

  useEffect(() => {
    if (!active) return
    attach((js) => web.current?.injectJavaScript(js))
    return () => attach(null)
  }, [active])
  // Moteur tué par le système (mémoire) : on repartira d'une WebView neuve à la prochaine demande.
  const onGone = useCallback(() => useAiHost.setState({ active: false, progress: null }), [])
  // Seule la page moteur peut être chargée : aucune navigation ailleurs.
  const allow = useCallback((r: ShouldStartLoadRequest) => r.url === page, [page])

  return (
    <>
      {active ? (
        <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <WebView
            ref={web}
            source={{ uri: page }}
            originWhitelist={['https://*', 'http://*']}
            onShouldStartLoadWithRequest={allow}
            onMessage={(e: WebViewMessageEvent) => onEngineMessage(e.nativeEvent.data)}
            onRenderProcessGone={onGone}
            onContentProcessDidTerminate={onGone}
            onError={onGone}
            onHttpError={onGone}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess={false}
            allowsBackForwardNavigationGestures={false}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
          />
        </View>
      ) : null}
      {progress !== null ? (
        <View style={styles.banner} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.bannerText}>{t('ai.download.progress', { pct: Math.floor(progress * 100) })}</Text>
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 },
  banner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: 96,
    backgroundColor: colors.bgAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  bannerText: { color: colors.text, fontSize: font.sm, textAlign: 'center' },
})
