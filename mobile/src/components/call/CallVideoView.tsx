import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState, type ReactNode } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { IconName } from '@/components/ui'
import { useT } from '@/i18n'
import { defaultRatio, enterPip, pipSupported, useImmersive } from '@/services/callWindow'
import { font, radius, spacing } from '@/theme'
import { AutoHideView, useAutoHide } from './CallControls'
import { SelfView } from './SelfView'
import { QualityIcon, type CallTile } from './VideoTile'
import { ZoomableVideo } from './ZoomableVideo'

/** Hauteur réservée aux commandes du bas (vignette déplaçable au-dessus). */
const CONTROLS_SPACE = 150
const TOP_SPACE = 64

/**
 * Vidéo d'appel en grand : zoom (pincer, double appui), glisser pour se déplacer, bascule
 * remplir / ajuster, choix de la source (caméra ou écran de chacun), vignette déplaçable, commandes
 * qui se masquent seules et réapparaissent au toucher. `immersive` : barres système masquées et
 * rotation suivie (plein écran) ; `onClose` (appels de groupe, salons) ou `onImmersive` (appel privé,
 * dont c'est l'écran principal) pour en sortir — aussi par le geste ou le bouton retour.
 */
export function CallVideoView({
  sources,
  current,
  onCurrent,
  vignette,
  onVignettePress,
  immersive,
  onImmersive,
  onClose,
  header,
  controls,
}: {
  sources: CallTile[]
  current: string | null
  onCurrent: (key: string) => void
  vignette?: CallTile | null
  onVignettePress?: () => void
  immersive: boolean
  onImmersive?: (on: boolean) => void
  onClose?: () => void
  /** Nom, durée, cadenas de chiffrement… (masqués avec les commandes). */
  header?: ReactNode
  /** Rangée de boutons d'appel (micro, caméra, sortie audio, raccrocher…). */
  controls: ReactNode
}) {
  const t = useT()
  const insets = useSafeAreaInsets()
  const source = sources.find((s) => s.key === current) ?? sources[0] ?? null
  const [fits, setFits] = useState<Record<string, 'cover' | 'contain'>>({})
  const [ratio, setRatio] = useState<[number, number] | null>(null)
  const auto = useAutoHide(!!source)
  useImmersive(immersive)

  // Retour Android : quitte le plein écran avant de quitter l'écran.
  useEffect(() => {
    const exit = onClose ?? (immersive && onImmersive ? () => onImmersive(false) : null)
    if (!exit) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exit()
      return true
    })
    return () => sub.remove()
  }, [onClose, onImmersive, immersive])

  if (!source?.stream) return null
  // Caméra : remplit l'écran ; écran partagé : image entière (texte lisible), au choix ensuite.
  const fit = fits[source.key] ?? (source.screen ? 'contain' : 'cover')
  const showVignette = vignette?.stream && vignette.key !== source.key

  return (
    <View style={styles.root}>
      <ZoomableVideo
        key={source.key}
        stream={source.stream}
        fit={fit}
        mirror={source.mirror}
        onTap={auto.toggle}
        onDimensions={(w, h) => setRatio([w, h])}
        label={source.name}
        hint={t('call.showControls')}
      />

      {showVignette ? <SelfView tile={vignette} onPress={onVignettePress} top={auto.visible ? TOP_SPACE : 0} bottom={auto.visible ? CONTROLS_SPACE : 0} /> : null}

      <AutoHideView visible={auto.visible} from="top" onTouch={auto.poke} style={[styles.top, { paddingTop: insets.top + spacing.sm, paddingLeft: insets.left + spacing.md, paddingRight: insets.right + spacing.md }]}>
        <View style={styles.topRow}>
          {onClose ? <TopButton icon="chevron-down" label={t('call.exitFullscreen')} onPress={onClose} /> : null}
          <View style={styles.titleBox}>
            {header ?? (
              <View style={styles.sourceName}>
                <QualityIcon quality={source.quality} size={14} />
                <Text style={styles.title} numberOfLines={1}>
                  {source.self ? t('voice.you', { name: source.name }) : source.name}
                </Text>
              </View>
            )}
          </View>
          <TopButton
            icon={fit === 'cover' ? 'contract-outline' : 'expand-outline'}
            label={t(fit === 'cover' ? 'call.fit' : 'call.fill')}
            onPress={() => setFits((f) => ({ ...f, [source.key]: fit === 'cover' ? 'contain' : 'cover' }))}
          />
          {pipSupported() ? <TopButton icon="albums-outline" label={t('call.pip')} onPress={() => enterPip(ratio ?? defaultRatio(source.screen))} /> : null}
          {onImmersive ? (
            <TopButton
              icon={immersive ? 'scan' : 'scan-outline'}
              label={t(immersive ? 'call.exitFullscreen' : 'call.fullscreen')}
              onPress={() => onImmersive(!immersive)}
              active={immersive}
            />
          ) : null}
        </View>
      </AutoHideView>

      <AutoHideView visible={auto.visible} onTouch={auto.poke} style={[styles.bottom, { paddingBottom: insets.bottom + spacing.lg }]}>
        {sources.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {sources.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => onCurrent(s.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: s.key === source.key }}
                style={[styles.chip, s.key === source.key && styles.chipOn]}
              >
                {s.screen ? <Ionicons name="tv-outline" size={12} color={s.key === source.key ? '#111214' : '#fff'} /> : null}
                <Text style={[styles.chipText, s.key === source.key && { color: '#111214' }]} numberOfLines={1}>
                  {s.self ? t('voice.you', { name: s.name }) : s.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.controls}>{controls}</View>
      </AutoHideView>
    </View>
  )
}

function TopButton({ icon, label, onPress, active }: { icon: IconName; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active }} style={styles.topBtn}>
      <Ionicons name={icon} size={22} color="#fff" />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.35)', paddingBottom: spacing.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleBox: { flex: 1, minWidth: 0 },
  sourceName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#fff', fontSize: font.md, fontWeight: '700', flexShrink: 1, textShadowColor: '#000', textShadowRadius: 6 },
  topBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: spacing.md, paddingTop: spacing.md, backgroundColor: 'rgba(0,0,0,0.35)' },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.18)' },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontWeight: '700', fontSize: font.sm, flexShrink: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
})
