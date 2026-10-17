// WebView cachée du moteur d'IA sur l'appareil (bridge.ts) et bandeau de téléchargement
// des modèles. Montée seulement après la première demande (traduire, transcrire, réglages).
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { apiOrigin } from '@/config/env'
import { useT } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'
import { attach, onEngineMessage, useAiHost } from './bridge'
import { loadVerifiedEngine } from './engineIntegrity'

export default function AiEngineHost() {
  const t = useT()
  const active = useAiHost((s) => s.active)
  const progress = useAiHost((s) => s.progress)
  const web = useRef<WebView>(null)
  const origin = apiOrigin()
  // Page moteur : vérifiée contre les SHA-256 embarqués (engineIntegrity.ts) avant d'être injectée.
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let alive = true
    void loadVerifiedEngine(origin).then((h) => {
      if (!alive) return
      if (h) setHtml(h)
      else useAiHost.setState({ active: false, progress: null }) // refusée : moteur indisponible, jamais de repli sur le code servi
    })
    return () => {
      alive = false
      setHtml(null)
    }
  }, [active, origin])
  useEffect(() => {
    if (!active || !html) return
    attach((js) => web.current?.injectJavaScript(js))
    return () => attach(null)
  }, [active, html])
  // Moteur tué par le système (mémoire) : on repartira d'une WebView neuve à la prochaine demande.
  const onGone = useCallback(() => useAiHost.setState({ active: false, progress: null }), [])
  // Seule la page moteur (baseUrl) peut être chargée : aucune navigation ailleurs.
  const allow = useCallback((r: ShouldStartLoadRequest) => r.url === `${origin}/` || r.url === 'about:blank', [origin])

  return (
    <>
      {active && html ? (
        <View style={styles.hidden} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <WebView
            ref={web}
            source={{ html, baseUrl: `${origin}/` }}
            originWhitelist={__DEV__ ? ['https://*', 'http://*'] : ['https://*']}
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
