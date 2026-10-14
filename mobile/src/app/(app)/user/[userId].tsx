import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { friendsApi } from '@/api/friends'
import { serversApi } from '@/api/servers'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { AvatarRing, effectiveRing } from '@/components/AvatarRing'
import { SafetyCode } from '@/e2e/E2ESettings'
import { useAccountKey } from '@/e2e/accountKey'
import { NOTE_LOCKED, loadNote, saveNote } from '@/e2e/notes'
import { UserSocialInfo } from '@/features/social/UserSocialInfo'
import { Button, ErrorState, Loading, Row, Section, TextField } from '@/components/ui'
import { MessageText } from '@/components/MessageText'
import { StyledName, previewName } from '@/components/UserName'
import { ProfileEffect } from '@/components/ProfileDecor'
import { ProfileCardFrame } from '@/features/account/ProfileCardView'
import { cardHeader, cardOnColor, cleanCard } from '@/features/account/profileCard'
import { hexColor } from '@/features/account/profileDecor'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { openDmWith } from '@/features/friends/openDm'
import { relationWith } from '@/features/friends/relation'
import { shownProfile } from '@/features/servers/memberProfile'
import { platformIcon, publicAccounts } from '@/features/servers/discordFeatures'
import { useT } from '@/i18n'
import { formatUntil } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { openExternalUrl } from '@/lib/links'
import { cleanNameStyle, displayNameOf } from '@/lib/nameStyle'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { colors, font, radius, spacing } from '@/theme'

export default function UserScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['userId'] as const, ['serverId'])
  // Ouverte depuis un serveur : profil propre à ce serveur (surnom, avatar, bannière, bio).
  const serverId = isUuid(text.serverId) ? text.serverId : ''
  const me = useAuth((s) => s.user)
  const q = useQuery({ queryKey: qk.user(ids.userId ?? ''), queryFn: () => usersApi.get(ids.userId), enabled: valid })
  const members = useQuery({ queryKey: qk.members(serverId), queryFn: () => serversApi.members(serverId), enabled: valid && !!serverId })
  const accepted = useQuery({ queryKey: qk.friends('all'), queryFn: () => friendsApi.list('all') })
  const pending = useQuery({ queryKey: qk.friends('pending'), queryFn: () => friendsApi.list('pending') })
  const blocked = useQuery({ queryKey: qk.friends('blocked'), queryFn: () => friendsApi.list('blocked') })
  const keyStatus = useAccountKey((s) => s.status)
  if (!valid) return <ErrorState message={t('social.user.invalid')} />
  if (q.isLoading) return <Loading />
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error, t('social.user.notFound'))} onRetry={() => void q.refetch()} />
  const u = q.data
  const member = members.data?.find((m) => m.user_id === u.id)
  const shown = shownProfile(u, member)
  // Style du pseudo propre au serveur s'il existe, sinon celui du compte (tous deux relus par liste blanche).
  const nameStyle = cleanNameStyle(member?.server_name_style) ?? cleanNameStyle(u.name_style)
  const isMe = u.id === me?.id
  // Thème du profil : texte clair sur le voile sombre de la fiche colorée.
  const card = cleanCard(u.profile_card)
  const head = cardHeader(card)
  const themed = cardOnColor(card.card, u.profile_color_primary != null || u.profile_color_accent != null)
  // Anneau effectif : celui du profil de serveur s'il existe, sinon l'anneau global du compte.
  const ring = effectiveRing(member, u.avatar_ring)
  const align = head.textCenter ? ('center' as const) : ('flex-start' as const)
  const primaryHex = u.profile_color_primary != null ? hexColor(u.profile_color_primary) : undefined
  const relation = relationWith(u.id, [blocked.data?.friends, accepted.data?.friends, pending.data?.friends])

  const run = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.friendsAll })
        Alert.alert(ok)
      })
      .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl }} keyboardShouldPersistTaps="handled">
      <ProfileCardFrame card={card} primary={u.profile_color_primary} accent={u.profile_color_accent} style={styles.card}>
        {/* Clé effet-intensité : les particules sont recréées quand l'un des deux change. */}
        <ProfileEffect key={`${u.profile_effect ?? ''}-${u.profile_effect_intensity ?? ''}`} id={u.profile_effect} intensity={u.profile_effect_intensity} />
        <ProfileBanner uri={shown.banner} name={u.username} card={card} tint={primaryHex} fadeTo={primaryHex} />
        <View style={[styles.header, head.row && styles.headerRow]}>
          <View style={{ alignSelf: head.row ? 'auto' : head.avatarCenter ? 'center' : 'flex-start' }}>
            <AvatarRing ring={ring} size={head.avatar}>
              <Avatar uri={shown.avatar} name={u.username} size={head.avatar} userId={u.id} status={u.status} showStatus decoration={u.avatar_decoration} decorationOpts={u.avatar_decoration_opts} />
            </AvatarRing>
          </View>
          <View style={{ alignItems: align, alignSelf: 'stretch', flex: head.row ? 1 : undefined, gap: 4 }}>
            <View style={[styles.nameRow, { justifyContent: align }]}>
              <StyledName
                text={displayNameOf(u, member?.nickname)}
                resolved={previewName(nameStyle)}
                style={[styles.name, { textAlign: head.textCenter ? 'center' : 'left' }, themed && styles.onTheme]}
                tag={u.profile_tag}
                tagStyle={nameStyle?.tag ?? null}
                clanTags={member?.tags}
                numberOfLines={2}
              />
            </View>
            <Text style={[styles.tag, themed && styles.onThemeMuted]}>
              {u.username}#{u.discriminator}
              {u.pronouns ? ` · ${u.pronouns}` : ''}
            </Text>
            {u.custom_status ? (
              <Text style={[styles.status, themed && styles.onThemeMuted, { textAlign: head.textCenter ? 'center' : 'left' }]}>
                {u.custom_status}
                {u.custom_status_expires_at ? ` · ${t('settings.status.until', { when: formatUntil(u.custom_status_expires_at) })}` : ''}
              </Text>
            ) : null}
            {card.show_links && u.profile_links?.length ? (
              <View style={[styles.links, { justifyContent: align }]}>
                {u.profile_links
                  .filter((l) => l.url.startsWith('https://'))
                  .map((l, i) => (
                    <Pressable
                      key={`${i}-${l.url}`}
                      onPress={() => void openExternalUrl(l.url)}
                      style={styles.link}
                      accessibilityRole="link"
                      accessibilityHint={l.url}
                    >
                      <Ionicons name="link" size={14} color={colors.link} />
                      <Text style={styles.linkText} numberOfLines={1}>
                        {l.label}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            ) : null}
          </View>
        </View>
      </ProfileCardFrame>

      {shown.bio ? (
        <Section title={t('social.user.about')}>
          <View style={{ padding: spacing.lg }}>
            <MessageText content={shown.bio} />
          </View>
        </Section>
      ) : null}

      <UserSocialInfo userId={u.id} activity={u} showBadges={card.show_badges} />
      {card.show_links ? <ConnectedAccounts userId={u.id} /> : null}
      {!isMe ? <MutualServers userId={u.id} /> : null}
      {!isMe ? <SafetyCode userId={u.id} /> : null}
      {!isMe && relation.kind === 'friend' ? (
        <SavedText
          title={t('social.user.nickname')}
          footer={t('social.user.nicknameFooter')}
          queryKey={['friend-nickname', u.id]}
          load={() => friendsApi.nickname(u.id).then((r) => r.nickname)}
          save={(v) => friendsApi.setNickname(u.id, v).then(() => void queryClient.invalidateQueries({ queryKey: qk.friendsAll }))}
          maxLength={64}
        />
      ) : null}
      {!isMe ? (
        <SavedText
          title={`🔒 ${t('soc.note.label')}`}
          footer={t('soc.note.ph')}
          queryKey={['user-note', u.id, keyStatus]}
          load={() => loadNote(u.id)}
          save={(v) => saveNote(u.id, v)}
          maxLength={2000}
          multiline
          lockedText={t('soc.note.locked')}
        />
      ) : null}

      {!isMe ? (
        <View style={{ gap: spacing.md }}>
          <Button title={t('social.user.sendMessage')} icon="chatbubble" onPress={() => void openDmWith(u.id, u.username)} />
          <Button title={t('rs.button')} icon="help-buoy-outline" variant="secondary" onPress={() => void openDmWith(u.id, u.username, true)} />
          {relation.kind === 'none' ? (
            <Button
              title={t('social.user.addFriend')}
              icon="person-add"
              variant="secondary"
              onPress={() => run(() => friendsApi.addByName(`${u.username}#${u.discriminator}`), t('social.user.requestSent'))}
            />
          ) : relation.kind === 'received' ? (
            <Button
              title={t('social.user.acceptRequest')}
              icon="person-add"
              variant="secondary"
              onPress={() => run(() => friendsApi.accept(relation.friendshipId), t('social.user.requestAccepted'))}
            />
          ) : relation.kind === 'sent' ? (
            <Text style={styles.relation}>{t('social.user.requestSent')}</Text>
          ) : relation.kind === 'friend' ? (
            <Text style={styles.relation}>{t('social.user.friends')}</Text>
          ) : null}
          {relation.kind === 'blocked' ? (
            <Button
              title={t('friends.unblock')}
              icon="ban"
              variant="ghost"
              onPress={() => run(() => friendsApi.unblock(u.id), t('social.user.unblocked'))}
            />
          ) : (
            <Button
              title={t('friends.block')}
              icon="ban"
              variant="ghost"
              onPress={() =>
                Alert.alert(t('friends.blockConfirm'), t('friends.blockBody', { name: u.username }), [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('friends.block'), style: 'destructive', onPress: () => run(() => friendsApi.block(u.id), t('social.user.blocked')) },
                ])
              }
            />
          )}
        </View>
      ) : (
        <Button title={t('social.user.editProfile')} onPress={() => router.push('/settings/profile')} />
      )}
    </ScrollView>
  )
}

/** Comptes connectés que la personne a rendus visibles (GET /users/:id/profile), masqués avec ses liens. */
function ConnectedAccounts({ userId }: { userId: string }) {
  const t = useT()
  const q = useQuery({ queryKey: ['user-profile', userId], queryFn: () => usersApi.profile(userId), select: (p) => publicAccounts(p.connected_accounts) })
  if (!q.data?.length) return null
  return (
    <Section title={t('df.accounts.title')}>
      {q.data.map((a) => {
        const url = a.url
        return (
          <Row
            key={`${a.platform}:${a.username}`}
            icon={platformIcon(a.platform)}
            title={a.username}
            subtitle={a.verified ? `${a.platform} · ${t('df.accounts.verified')}` : a.platform}
            onPress={url ? () => void openExternalUrl(url) : undefined}
            right={url ? <Ionicons name="open-outline" size={16} color={colors.textFaint} /> : undefined}
          />
        )
      })}
    </Section>
  )
}

function MutualServers({ userId }: { userId: string }) {
  const t = useT()
  const q = useQuery({ queryKey: ['mutual-servers', userId], queryFn: () => usersApi.mutualServers(userId) })
  if (!q.data?.length) return null
  return (
    <Section title={t('social.user.mutualServers', { n: q.data.length })}>
      {q.data.map((s) => (
        <Row
          key={s.id}
          title={s.name}
          subtitle={s.member_role_names.length ? s.member_role_names.join(', ') : null}
          right={<Avatar uri={s.icon} name={s.name} size={28} rounded={false} />}
        />
      ))}
    </Section>
  )
}

/** Champ texte privé enregistré côté serveur (note, surnom d'ami). */
function SavedText({
  title,
  footer,
  queryKey,
  load,
  save,
  maxLength,
  multiline,
  lockedText,
}: {
  title: string
  footer: string
  queryKey: string[]
  load: () => Promise<string>
  save: (v: string) => Promise<unknown>
  maxLength: number
  multiline?: boolean
  /** Affiché si `load` lève NOTE_LOCKED (clé de compte fermée). */
  lockedText?: string
}) {
  const t = useT()
  const q = useQuery({ queryKey, queryFn: load, retry: (n, e) => n < 2 && !(e instanceof Error && e.message === NOTE_LOCKED) })
  /** null tant que rien n'est tapé : on affiche la valeur du serveur. */
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (lockedText && q.error instanceof Error && q.error.message === NOTE_LOCKED) return <Section title={title} footer={lockedText}>{null}</Section>
  if (q.data === undefined) return null
  const value = draft ?? q.data
  const submit = async () => {
    setBusy(true)
    try {
      await save(value.trim())
      queryClient.setQueryData(queryKey, value.trim())
      setDraft(null)
    } catch (e) {
      Alert.alert(t('social.user.saveFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={title} footer={footer}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <TextField
          accessibilityLabel={title}
          value={value}
          onChangeText={setDraft}
          maxLength={maxLength}
          multiline={multiline}
          style={multiline ? { minHeight: 80, textAlignVertical: 'top' } : undefined}
        />
        {value.trim() !== q.data ? <Button title={t('composer.save')} variant="secondary" onPress={() => void submit()} loading={busy} /> : null}
      </View>
    </Section>
  )
}

const styles = StyleSheet.create({
  header: { gap: 4, marginTop: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  name: { color: colors.text, fontSize: font.xxl, fontWeight: '800' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bgElevated },
  linkText: { color: colors.link, fontSize: font.sm, fontWeight: '600', flexShrink: 1 },
  tag: { color: colors.textMuted },
  status: { color: colors.textSecondary, marginTop: spacing.sm },
  relation: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm },
  card: { padding: spacing.md, marginBottom: spacing.xl },
  onTheme: { color: '#fff' },
  onThemeMuted: { color: 'rgba(255,255,255,0.8)' },
})
