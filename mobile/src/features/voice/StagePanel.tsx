import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { Button, IconButton } from '@/components/ui'
import { useVoice, type StageUser } from '@/stores/voice'
import { colors, font, radius, spacing } from '@/theme'

/**
 * Salon Scène (comme client/src/components/voice/StageChannel.tsx) : orateurs, mains levées, audience
 * (participants du vocal qui ne sont pas orateurs). `isModerator` = MANAGE_CHANNELS ; le serveur reste juge.
 */
export function StagePanel({ me, isModerator }: { me: StageUser; isModerator: boolean }) {
  const v = useVoice()
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
      <Group title={`Orateurs (${stage.speakers.length})`} empty="Aucun orateur pour le moment">
        {stage.speakers.map((u) => (
          <Person key={u.userId} user={u} me={me.userId} speaking={v.speaking.includes(u.userId)}>
            {isModerator && u.userId !== me.userId ? (
              <IconButton icon="person-remove-outline" label={`Retirer la parole à ${u.username}`} onPress={() => v.stageRemoveSpeaker(u.userId)} />
            ) : null}
          </Person>
        ))}
      </Group>

      {stage.hands.length ? (
        <Group title={`✋ Demandes de parole (${stage.hands.length})`}>
          {stage.hands.map((u) => (
            <Person key={u.userId} user={u} me={me.userId}>
              {isModerator ? <Button title="Accepter" onPress={() => v.stageInvite(u.userId)} style={styles.small} /> : null}
            </Person>
          ))}
        </Group>
      ) : null}

      <Group title={`Audience (${audience.length})`} empty="Aucun auditeur">
        {audience.map((u) => (
          <Person key={u.userId} user={u} me={me.userId}>
            {isModerator && u.userId !== me.userId ? (
              <IconButton icon="person-add-outline" label={`Inviter ${u.username} à parler`} onPress={() => v.stageInvite(u.userId)} />
            ) : null}
          </Person>
        ))}
      </Group>

      <View style={styles.actions}>
        {amSpeaker ? (
          <Button title="Quitter la scène" icon="exit-outline" variant="secondary" onPress={() => v.stageRemoveSpeaker()} />
        ) : (
          <>
            {isModerator ? (
              <Button title="Prendre la parole" icon="mic" onPress={() => v.stageInvite(me.userId)} />
            ) : (
              <Button
                title={stage.requested ? 'Demande envoyée…' : 'Demander à parler'}
                icon="mic"
                disabled={stage.requested}
                onPress={v.stageRequestSpeak}
              />
            )}
            <Button
              title={handRaised ? 'Baisser la main' : 'Lever la main'}
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
  return (
    <View style={styles.person} accessible={!children} accessibilityLabel={`${user.username}${speaking ? ', parle' : ''}`}>
      <View style={[styles.avatar, speaking && { borderColor: colors.success }]}>
        <Avatar uri={user.avatar} name={user.username} size={36} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {user.userId === me ? `${user.username} (toi)` : user.username}
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
