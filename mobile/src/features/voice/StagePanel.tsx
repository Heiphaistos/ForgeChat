import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { Button, IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { useVoice, type StageUser } from '@/stores/voice'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Salon Scène (comme client/src/components/voice/StageChannel.tsx) : orateurs, mains levées, audience
 * (participants du vocal qui ne sont pas orateurs). `isModerator` = MANAGE_CHANNELS ; le serveur reste juge.
 */
export function StagePanel({ me, isModerator }: { me: StageUser; isModerator: boolean }) {
  const v = useVoice()
  const t = useT()
  const stage = v.stage
  if (!stage) return null
  const isSpeaker = (id: string) => stage.speakers.some((u) => u.userId === id)
  const amSpeaker = isSpeaker(me.userId)
  const handRaised = stage.hands.some((u) => u.userId === me.userId)
  const audience: StageUser[] = [
    ...(amSpeaker ? [] : [me]),
    ...v.peers.filter((p) => !isSpeaker(p.userId)).map((p) => ({ userId: p.userId, username: p.username, avatar: p.avatar })),
  ]

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Group title={t('panel.stage.speakers', { n: stage.speakers.length })} empty={t('panel.stage.noSpeakers')}>
        {stage.speakers.map((u) => (
          <Person key={u.userId} user={u} me={me.userId} speaking={v.speaking.includes(u.userId)}>
            {isModerator && u.userId !== me.userId ? (
              <IconButton icon="person-remove-outline" label={t('panel.stage.removeSpeaker', { name: u.username })} onPress={() => v.stageRemoveSpeaker(u.userId)} />
            ) : null}
          </Person>
        ))}
      </Group>

      {stage.hands.length ? (
        <Group title={t('panel.stage.hands', { n: stage.hands.length })}>
          {stage.hands.map((u) => (
            <Person key={u.userId} user={u} me={me.userId}>
              {isModerator ? <Button title={t('panel.stage.accept')} onPress={() => v.stageInvite(u.userId)} style={styles.small} /> : null}
            </Person>
          ))}
        </Group>
      ) : null}

      <Group title={t('panel.stage.audience', { n: audience.length })} empty={t('panel.stage.noAudience')}>
        {audience.map((u) => (
          <Person key={u.userId} user={u} me={me.userId}>
            {isModerator && u.userId !== me.userId ? (
              <IconButton icon="person-add-outline" label={t('panel.stage.invite', { name: u.username })} onPress={() => v.stageInvite(u.userId)} />
            ) : null}
          </Person>
        ))}
      </Group>

      <View style={styles.actions}>
        {amSpeaker ? (
          <Button title={t('panel.stage.leave')} icon="exit-outline" variant="secondary" onPress={() => v.stageRemoveSpeaker()} />
        ) : (
          <>
            {isModerator ? (
              <Button title={t('panel.stage.speak')} icon="mic" onPress={() => v.stageInvite(me.userId)} />
            ) : (
              <Button
                title={t(stage.requested ? 'panel.stage.requested' : 'panel.stage.request')}
                icon="mic"
                disabled={stage.requested}
                onPress={v.stageRequestSpeak}
              />
            )}
            <Button
              title={t(handRaised ? 'panel.stage.lowerHand' : 'panel.stage.raiseHand')}
              icon="hand-left-outline"
              variant="secondary"
              onPress={v.stageToggleHand}
              accessibilityState={{ selected: handRaised }}
            />
          </>
        )}
      </View>
    </ScrollView>
  )
}

function Group({ title, empty, children }: { title: string; empty?: string; children: ReactNode[] }) {
  return (
    <View style={styles.group} accessibilityLabel={title}>
      <Text style={styles.title} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children.length ? children : <Text style={styles.empty}>{empty}</Text>}
    </View>
  )
}

function Person({ user, me, speaking, children }: { user: StageUser; me: string; speaking?: boolean; children?: ReactNode }) {
  const t = useT()
  return (
    <View style={styles.person} accessible={!children} accessibilityLabel={speaking ? t('panel.stage.speaking', { name: user.username }) : user.username}>
      <View style={[styles.avatar, speaking && { borderColor: colors.success }]}>
        <Avatar uri={user.avatar} name={user.username} size={36} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {user.userId === me ? t('panel.stage.me', { name: user.username }) : user.username}
      </Text>
      {speaking ? <Ionicons name="mic" size={16} color={colors.success} /> : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg },
  group: { gap: spacing.xs },
  title: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
  empty: { color: colors.textFaint, fontSize: font.sm, fontStyle: 'italic' },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  avatar: { borderRadius: radius.full, borderWidth: 2, borderColor: 'transparent' },
  name: { flex: 1, color: colors.text, fontSize: font.md },
  actions: { gap: spacing.sm },
  small: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, minHeight: 0 },
})
