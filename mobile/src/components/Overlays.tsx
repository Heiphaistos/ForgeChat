import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IS_LAN } from '@/config/env'
import { formatDuration } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { useConnection } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useLock } from '@/stores/lock'
import { useVoice } from '@/stores/voice'
import { colors, font, radius, spacing } from '@/theme'
import { Avatar } from './Avatar'
import { Button, Loading } from './ui'

/** Écran de démarrage / hors-ligne au-dessus de la navigation. */
export function BootOverlay() {
  const status = useAuth((s) => s.status)
  const bootstrap = useAuth((s) => s.bootstrap)
  const logout = useAuth((s) => s.logout)
  if (status !== 'booting' && status !== 'offline') return null
  return (
    <View style={[StyleSheet.absoluteFill, styles.full]}>
      {status === 'booting' ? (
        <Loading label="Connexion sécurisée…" />
      ) : (
        <View style={{ alignItems: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <Ionicons name="cloud-offline-outline" size={56} color={colors.textMuted} />
          <Text style={styles.title}>Serveur injoignable</Text>
          <Text style={styles.sub}>Vérifie ta connexion internet puis réessaie.</Text>
          <Button title="Réessayer" onPress={() => void bootstrap()} style={{ alignSelf: 'stretch' }} />
          <Button title="Se déconnecter" variant="ghost" onPress={() => void logout()} />
        </View>
      )}
    </View>
  )
}

/** Voile opaque tant que l'app est verrouillée (biométrie). */
export function LockOverlay() {
  const locked = useLock((s) => s.locked)
  const unlock = useLock((s) => s.unlock)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  useEffect(() => {
    if (locked && signedIn) void unlock()
  }, [locked, signedIn, unlock])
  if (!locked || !signedIn) return null
  return (
    <View style={[StyleSheet.absoluteFill, styles.full]} accessibilityViewIsModal>
      <Ionicons name="lock-closed" size={56} color={colors.primary} />
      <Text style={[styles.title, { marginTop: spacing.lg }]}>ForgeChat est verrouillé</Text>
      <Button title="Déverrouiller" icon="finger-print" onPress={() => void unlock()} style={{ marginTop: spacing.xl, minWidth: 220 }} />
    </View>
  )
}

/** Bandeau de connexion temps réel perdue. */
export function ConnectionBanner() {
  const status = useConnection((s) => s.status)
  const signedIn = useAuth((s) => s.status === 'signedIn')
  const insets = useSafeAreaInsets()
  // Ne s'affiche qu'après 2,5 s de coupure (évite le clignotement lors des reconnexions rapides).
  const [delayed, setDelayed] = useState(status)
  useEffect(() => {
    const t = setTimeout(() => setDelayed(status), status === 'reconnecting' ? 2500 : 0)
    return () => clearTimeout(t)
  }, [status])
  const visible = status === 'reconnecting' && delayed === 'reconnecting'
  if (!signedIn || !visible) return null
  return (
    <View style={[styles.banner, { top: insets.top }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <Text style={styles.bannerText}>Reconnexion…</Text>
    </View>
  )
}

/** Profil LAN : rappel permanent qu'il s'agit d'un APK de test local (jamais distribué). */
export function EnvBanner() {
  const insets = useSafeAreaInsets()
  if (!IS_LAN) return null
  return (
    <View style={[styles.envBanner, { top: insets.top + 2 }]} pointerEvents="none" accessibilityLabel="Version de test local">
      <Text style={styles.bannerText}>Test local</Text>
    </View>
  )
}

/** Appel entrant (plein écran). */
export function IncomingCallOverlay() {
  const incoming = useCall((s) => s.incoming)
  const accept = useCall((s) => s.accept)
  const decline = useCall((s) => s.decline)
  const locked = useLock((s) => s.locked)
  const insets = useSafeAreaInsets()
  if (!incoming) return null
  return (
    <View style={[StyleSheet.absoluteFill, styles.call, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }]}>
      <View style={{ alignItems: 'center', gap: spacing.md }}>
        <Avatar uri={null} name={incoming.fromUsername} size={96} />
        <Text style={styles.title}>{incoming.fromUsername}</Text>
        <Text style={styles.sub}>{incoming.callType === 'video' ? 'Appel vidéo entrant…' : 'Appel vocal entrant…'}</Text>
      </View>
      <View style={styles.callButtons}>
        <Pressable style={[styles.round, { backgroundColor: colors.danger }]} onPress={decline} accessibilityRole="button" accessibilityLabel="Refuser l'appel">
          <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
        </Pressable>
        <Pressable
          style={[styles.round, { backgroundColor: colors.success }]}
          onPress={async () => {
            // Si l'app est verrouillée, on exige le déverrouillage avant de décrocher.
            if (locked && !(await useLock.getState().unlock())) return
            await accept()
            router.push('/call')
          }}
          accessibilityRole="button"
          accessibilityLabel="Accepter l'appel"
        >
          <Ionicons name={incoming.callType === 'video' ? 'videocam' : 'call'} size={30} color="#fff" />
        </Pressable>
      </View>
    </View>
  )
}

/** Barre « appel en cours » / « vocal connecté » quand on navigue ailleurs. */
export function ActiveCallBar() {
  const phase = useCall((s) => s.phase)
  const partner = useCall((s) => s.partnerName)
  const connectedAt = useCall((s) => s.connectedAt)
  const voiceChannel = useVoice((s) => s.channelName)
  const voiceServer = useVoice((s) => s.serverId)
  const voiceChannelId = useVoice((s) => s.channelId)
  const now = useNow(1000, phase === 'connected')
  const insets = useSafeAreaInsets()

  if (phase !== 'idle') {
    return (
      <Pressable style={[styles.activeBar, { top: insets.top }]} onPress={() => router.push('/call')} accessibilityRole="button">
        <Ionicons name="call" size={14} color="#fff" />
        <Text style={styles.activeText}>
          {partner} · {phase === 'connected' && connectedAt ? formatDuration(now - connectedAt) : 'Appel…'}
        </Text>
      </Pressable>
    )
  }
  if (voiceChannel && voiceServer && voiceChannelId) {
    return (
      <Pressable
        style={[styles.activeBar, { top: insets.top }]}
        onPress={() => router.push(`/voice/${voiceServer}/${voiceChannelId}`)}
        accessibilityRole="button"
      >
        <Ionicons name="volume-high" size={14} color="#fff" />
        <Text style={styles.activeText}>Vocal : {voiceChannel}</Text>
      </Pressable>
    )
  }
  return null
}

const styles = StyleSheet.create({
  full: { backgroundColor: colors.bgDeep, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  title: { color: colors.text, fontSize: font.xl, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.textMuted, fontSize: font.md, textAlign: 'center' },
  banner: { position: 'absolute', alignSelf: 'center', backgroundColor: colors.warning, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4, zIndex: 50 },
  bannerText: { color: '#000', fontWeight: '700', fontSize: font.xs },
  envBanner: { position: 'absolute', right: spacing.sm, backgroundColor: colors.warning, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2, opacity: 0.85, zIndex: 95 },
  call: { backgroundColor: colors.bgDeep, justifyContent: 'space-between', alignItems: 'center', zIndex: 90 },
  callButtons: { flexDirection: 'row', gap: 80 },
  round: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  activeBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.success,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    zIndex: 40,
  },
  activeText: { color: '#fff', fontWeight: '700', fontSize: font.xs },
})
