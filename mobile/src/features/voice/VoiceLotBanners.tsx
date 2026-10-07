import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '@/i18n'
import { useVoice } from '@/stores/voice'
import { admitWaiting, useVoiceWaitingQueue } from '@/stores/voiceExtras'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Bandeaux du salon vocal : salle d'attente (moi qui attends ; file des arrivants pour un
 * modérateur) et consentement à l'enregistrement (qui enregistre, refus possible).
 */
export function VoiceLotBanners({ canAdmit }: { canAdmit: boolean }) {
  const t = useT()
  const waiting = useVoice((s) => s.waiting)
  const channelId = useVoice((s) => s.channelId)
  const peers = useVoice((s) => s.peers)
  const noRecord = useVoice((s) => s.noRecord)
  const setNoRecord = useVoice((s) => s.setNoRecord)
  const queue = useVoiceWaitingQueue((s) => (channelId ? s.queues[channelId] : undefined)) ?? []
  const recorders = peers.filter((p) => p.recording).map((p) => p.username)

  if (waiting) {
    return (
      <View style={[styles.bar, { backgroundColor: colors.warning }]} accessibilityLiveRegion="polite">
        <Text style={[styles.text, { color: '#000' }]}>⏳ {t('voiceLot.waiting.self')}</Text>
      </View>
    )
  }
  return (
    <>
      {recorders.length ? (
        <View style={[styles.bar, { backgroundColor: colors.danger }]} accessibilityLiveRegion="polite">
          <Text style={styles.text}>● REC — {t('voiceLot.rec.banner', { names: recorders.join(', ') })}</Text>
          <Pressable onPress={() => setNoRecord(!noRecord)} style={styles.btn} accessibilityRole="button">
            <Text style={styles.btnText}>{t(noRecord ? 'voiceLot.rec.allow' : 'voiceLot.rec.refuse')}</Text>
          </Pressable>
        </View>
      ) : null}
      {canAdmit && channelId && queue.length ? (
        <View style={styles.queue}>
          <Text style={styles.queueTitle}>{t('voiceLot.waiting.title', { n: queue.length })}</Text>
          {queue.map((u) => (
            <View key={u.userId} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {u.username}
              </Text>
              <Pressable onPress={() => admitWaiting(channelId, u.userId, true)} style={[styles.btn, { backgroundColor: colors.success }]} accessibilityRole="button" accessibilityLabel={t('voiceLot.waiting.admit', { name: u.username })}>
                <Text style={styles.btnText}>{t('voiceLot.waiting.admitShort')}</Text>
              </Pressable>
              <Pressable onPress={() => admitWaiting(channelId, u.userId, false)} style={[styles.btn, { backgroundColor: colors.bgElevated }]} accessibilityRole="button" accessibilityLabel={t('voiceLot.waiting.deny', { name: u.username })}>
                <Text style={[styles.btnText, { color: colors.text }]}>{t('voiceLot.waiting.denyShort')}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  text: { flex: 1, color: '#fff', fontSize: font.sm, fontWeight: '600' },
  btn: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.25)' },
  btnText: { color: '#fff', fontSize: font.xs, fontWeight: '700' },
  queue: { padding: spacing.md, gap: spacing.xs, backgroundColor: colors.bgElevated },
  queueTitle: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, color: colors.text, fontSize: font.sm },
})
