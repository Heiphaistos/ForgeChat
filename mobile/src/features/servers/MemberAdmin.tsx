import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { Sheet } from '@/components/Sheet'
import { Button, IconButton, Row, Section, SwitchRow, TextField } from '@/components/ui'
import { t as tr, useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import type { Channel } from '@/types/models'
import { colors, spacing } from '@/theme'

const fail = (e: unknown) => Alert.alert(tr('common.actionFailed'), errorMessage(e))

/**
 * Modération vocale d'un membre (PATCH /servers/:id/members/:u/voice) : muet et sourdine imposés,
 * déplacement, déconnexion. L'état vient de GET /voice/state ; le serveur revérifie droits et hiérarchie.
 */
export function VoiceModeration({
  serverId,
  userId,
  channels,
  can,
}: {
  serverId: string
  userId: string
  channels: Channel[]
  can: { mute: boolean; deafen: boolean; move: boolean }
}) {
  const t = useT()
  const state = useQuery({ queryKey: ['voice-state'], queryFn: moderationApi.voiceState, refetchInterval: 15_000 })
  const [moveOpen, setMoveOpen] = useState(false)
  const room = state.data?.channels.find((c) => c.server_id === serverId && c.participants.some((p) => p.user_id === userId))
  const me = room?.participants.find((p) => p.user_id === userId)
  const run = (body: Parameters<typeof moderationApi.voice>[2]) =>
    void moderationApi
      .voice(serverId, userId, body)
      .then(() => state.refetch())
      .catch(fail)
  const where = room ? channels.find((c) => c.id === room.channel_id)?.name : null
  const targets = channels.filter((c) => (c.type === 'voice' || c.type === 'video') && c.id !== room?.channel_id)

  return (
    <Section
      title={t('server.member.voice')}
      footer={room ? t('server.member.inVoice', { channel: where ?? t('server.member.aChannel') }) : t('server.member.notInVoice')}
    >
      {can.mute ? <SwitchRow icon="mic-off-outline" title={t('server.member.mute')} value={!!me?.server_muted} onValueChange={(v) => run({ mute: v })} /> : null}
      {can.deafen ? <SwitchRow icon="volume-mute-outline" title={t('server.member.deafen')} value={!!me?.server_deafened} onValueChange={(v) => run({ deafen: v })} /> : null}
      {can.move && room ? (
        <>
          <Row icon="swap-horizontal-outline" title={t('server.member.move')} chevron onPress={() => setMoveOpen(true)} />
          <Row icon="call-outline" title={t('server.member.disconnect')} danger onPress={() => run({ disconnect: true })} />
          <Sheet
            visible={moveOpen}
            onClose={() => setMoveOpen(false)}
            title={t('server.member.moveTo')}
            actions={targets.map((c) => ({ label: c.name, icon: 'volume-medium-outline', onPress: () => run({ channel_id: c.id }) }))}
          />
        </>
      ) : null}
    </Section>
  )
}

/** Notes de modération privées (MANAGE_MESSAGES). */
export function ModNotes({ serverId, userId }: { serverId: string; userId: string }) {
  const t = useT()
  const notes = useQuery({ queryKey: ['mod-notes', serverId, userId], queryFn: () => moderationApi.notes(serverId, userId) })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const add = () => {
    if (!text.trim()) return
    setBusy(true)
    void moderationApi
      .addNote(serverId, userId, text)
      .then(() => {
        setText('')
        return notes.refetch()
      })
      .catch(fail)
      .finally(() => setBusy(false))
  }
  return (
    <Section title={t('server.member.notes')} footer={t('server.member.notesFooter')}>
      {(notes.data ?? []).map((n) => (
        <Row
          key={n.id}
          title={n.note}
          subtitle={formatShort(n.created_at)}
          right={
            <IconButton
              icon="trash-outline"
              label={t('server.member.deleteNote')}
              color={colors.danger}
              onPress={() =>
                void moderationApi
                  .deleteNote(serverId, n.id)
                  .then(() => notes.refetch())
                  .catch(fail)
              }
            />
          }
        />
      ))}
      <View style={{ padding: spacing.sm, gap: spacing.sm }}>
        <TextField value={text} onChangeText={setText} placeholder={t('server.member.notePlaceholder')} accessibilityLabel={t('server.member.newNote')} multiline maxLength={2000} />
        <Button title={t('server.member.addNote')} variant="secondary" onPress={add} loading={busy} disabled={!text.trim()} />
      </View>
    </Section>
  )
}

/** Tags de clan d'un membre (MANAGE_ROLES). */
export function MemberTags({ serverId, userId }: { serverId: string; userId: string }) {
  const t = useT()
  const tags = useQuery({ queryKey: ['clan-tags', serverId], queryFn: () => moderationApi.tags(serverId) })
  const members = useQuery({ queryKey: ['members-detailed', serverId], queryFn: () => moderationApi.membersDetailed(serverId) })
  if (!tags.data?.length) return null
  const mine = new Set(members.data?.find((m) => m.user_id === userId)?.tags.map((tag) => tag.id))
  return (
    <Section title={t('server.member.tags')}>
      {tags.data.map((tag) => (
        <SwitchRow
          key={tag.id}
          title={tag.name}
          value={mine.has(tag.id)}
          disabled={!members.data}
          onValueChange={(on) =>
            void (on ? moderationApi.assignTag(serverId, userId, tag.id) : moderationApi.removeTag(serverId, userId, tag.id))
              .then(() => members.refetch())
              .catch(fail)
          }
        />
      ))}
    </Section>
  )
}
