// Carte « Support à distance » d'un MP (contenu chiffré `rs`). Android n'est qu'aidant :
// l'invitation s'ouvre dans la visionneuse web GhostHandDesk (onglet personnalisé du navigateur).
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { Ionicons } from '@expo/vector-icons'
import { messagesApi } from '@/api/messages'
import { usersApi } from '@/api/users'
import { t, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { expired, formatId, webViewerLink, type SupportPayload } from '@/lib/remoteSupport'
import type { ChatMessage } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'

/** Codes ouverts pendant cette session de l'appli (le vrai usage unique est garanti par l'hôte). */
const used = new Set<string>()

/** Envoie une carte de support chiffrée dans le MP (texte lisible sans identifiant ni code). */
export async function sendSupport(dmId: string, rs: SupportPayload, text: string) {
  await messagesApi.send({ kind: 'dm', dmId }, { content: text, support: rs })
}

/**
 * Support à distance réservé aux amis acceptés (scénario type de l'arnaque au faux support). Le
 * contenu est chiffré de bout en bout : la règle s'applique ici, pas au serveur.
 */
const isFriend = (userId: string) =>
  usersApi.profile(userId).then((p) => (p as { relationship?: unknown }).relationship === 'friend', () => false)

/** Menu « Support à distance » d'un MP : Android ne fait qu'aider (visionneuse web), il ne partage pas son écran. */
export async function promptSupport(dmId: string, partnerId: string | undefined) {
  if (!partnerId || !(await isFriend(partnerId))) {
    Alert.alert(t('rs.button'), t('rs.friendsOnly'))
    return
  }
  Alert.alert(t('rs.button'), undefined, [
    {
      text: t('rs.help'),
      onPress: () => void sendSupport(dmId, { v: 1, k: 'offer' }, t('rs.text.offer')).catch((e) => Alert.alert(t('rs.sendError'), errorMessage(e))),
    },
    { text: t('rs.ask'), onPress: () => Alert.alert(t('rs.button'), t('rs.androidHost')) },
    { text: t('common.cancel'), style: 'cancel' },
  ])
}

export function SupportCard({ m, dmId, mine, reply, replyBy }: { m: ChatMessage; dmId: string; mine: boolean; reply?: SupportPayload['k']; replyBy?: string }) {
  const t = useT()
  const rs = m.support
  const cmid = m.clientMsgId ?? ''
  const [opened, setOpened] = useState(() => used.has(cmid))
  // Reçu d'un non-ami : affiché, jamais actionnable.
  const friend = useQuery({
    queryKey: ['support-friend', m.authorId],
    queryFn: () => isFriend(m.authorId),
    enabled: !mine && !!m.authorId,
    staleTime: 30_000,
  }).data === true
  if (!rs || !cmid || rs.k === 'accept' || rs.k === 'decline') return null
  const answer = (k: 'accept' | 'decline') =>
    sendSupport(dmId, { v: 1, k, ref: cmid }, t(`rs.text.${k}`)).catch((e) => Alert.alert(t('rs.sendError'), errorMessage(e)))
  const time = rs.exp ? new Date(rs.exp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const isExpired = expired(rs)
  // Ma carte : le nom du correspondant (auteur de la réponse), pas le mien.
  const name = mine ? replyBy ?? '' : m.authorName
  const open = () => {
    if (!rs.id || !rs.code) return
    used.add(cmid)
    setOpened(true)
    void WebBrowser.openBrowserAsync(webViewerLink(rs.id, rs.code), { showTitle: true }).catch((e) => Alert.alert(t('rs.openFailed'), errorMessage(e)))
    if (!reply) void answer('accept')
  }
  const state = [
    isExpired ? t('rs.state.expired') : null,
    opened && !mine ? t('rs.state.used') : null,
    reply === 'decline' ? t('rs.state.declined') : reply ? t('rs.state.accepted') : null,
  ].filter(Boolean).join(' · ')

  let body: string
  if (rs.k === 'offer') body = t(mine ? (reply === 'accept' ? 'rs.card.offerAccepted' : 'rs.card.offerOut') : 'rs.card.offerIn', { name })
  else body = t(mine ? 'rs.card.inviteOut' : 'rs.card.inviteIn', { name, id: formatId(rs.id ?? ''), time })

  return (
    <View style={styles.card}>
      <View style={styles.title}>
        <Ionicons name="help-buoy-outline" size={16} color={colors.primary} />
        <Text style={styles.titleText}>{t('rs.card.title')}</Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      {!mine && !reply ? <Text style={styles.warn}>{t('rs.scam')}</Text> : null}
      {!mine && !friend ? <Text style={styles.fine}>{t('rs.friendsOnly')}</Text> : null}
      {!mine && friend && !reply ? (
        <View style={styles.row}>
          {rs.k === 'invite' && !isExpired && !opened ? (
            <Pressable accessibilityRole="button" style={[styles.btn, styles.primary]} onPress={open}>
              <Text style={styles.primaryText}>{t('rs.openWeb')}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" style={styles.btn} onPress={() => void answer('decline')}>
            <Text style={styles.btnText}>{t('rs.decline')}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.fine}>{state || t('rs.card.e2e')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, gap: spacing.xs, maxWidth: 420 },
  title: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  titleText: { color: colors.text, fontWeight: '700', fontSize: font.sm },
  body: { color: colors.text, fontSize: font.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  btn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.bgHover, minHeight: 40, justifyContent: 'center' },
  primary: { backgroundColor: colors.primary },
  btnText: { color: colors.text, fontSize: font.sm },
  primaryText: { color: '#ffffff', fontSize: font.sm, fontWeight: '600' },
  fine: { color: colors.textMuted, fontSize: font.xs },
  warn: { color: colors.warning, fontSize: font.xs, fontWeight: '600' },
})
