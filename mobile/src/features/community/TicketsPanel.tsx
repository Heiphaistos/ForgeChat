import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, View } from 'react-native'
import { communityApi, type Ticket } from '@/api/community'
import { messagesApi } from '@/api/messages'
import { Button, Row, Section, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { spacing } from '@/theme'

const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

/**
 * Tickets natifs : chaque ticket est un salon privé (membre + équipe) chiffré de bout en
 * bout. Le sujet part chiffré comme premier message ; le serveur ne garde que « Ticket #N ».
 */
export function TicketsPanel({ serverId }: { serverId: string }) {
  const t = useT()
  const meId = useAuth((s) => s.user?.id)
  const settings = useQuery({ queryKey: ['community', serverId, 'tickets/settings'], queryFn: () => communityApi.ticketSettings.get(serverId) })
  const tickets = useQuery({ queryKey: ['tickets', serverId], queryFn: () => communityApi.tickets(serverId), enabled: !!settings.data })
  const [subject, setSubject] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [busy, setBusy] = useState(false)
  const s = settings.data
  if (!s || (!s.enabled && !s.is_staff)) return null

  const goTo = (channelId: string) => router.push({ pathname: '/channel/[serverId]/[channelId]', params: { serverId, channelId } })
  const open = async () => {
    setBusy(true)
    try {
      const tk = await communityApi.openTicket(serverId, priority)
      await queryClient.invalidateQueries({ queryKey: qk.server(serverId) })
      if (tk.channel_id && subject.trim()) {
        await messagesApi.send({ kind: 'channel', serverId, channelId: tk.channel_id }, { content: subject.trim() })
      }
      setSubject('')
      void tickets.refetch()
      if (tk.channel_id) goTo(tk.channel_id)
    } catch (e) {
      Alert.alert(t('common.actionFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const setStatus = (tk: Ticket, status: Ticket['status']) =>
    void communityApi.setTicketStatus(serverId, tk.id, status).then(() => tickets.refetch(), (e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))

  return (
    <Section title={t('community.tickets.menu')} footer={t('community.tickets.subjectHint')}>
      {s.enabled ? (
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <TextField value={subject} onChangeText={setSubject} placeholder={t('community.tickets.subject')} multiline maxLength={4000}
            style={{ minHeight: 70, textAlignVertical: 'top' }} accessibilityLabel={t('community.tickets.subject')} />
          <ChoiceRow icon="flag-outline" title={t('community.tickets.priority')} value={priority}
            options={PRIORITIES.map((p) => ({ value: p as string, label: t(`community.tickets.p.${p}`) }))} onChange={setPriority} />
          <Button title={t('community.tickets.open')} icon="add" onPress={() => void open()} loading={busy} disabled={!subject.trim()} />
        </View>
      ) : (
        <T variant="muted" style={{ padding: spacing.md }}>{t('community.tickets.disabled')}</T>
      )}
      {(tickets.data ?? []).map((tk) => {
        const closed = tk.status === 'closed' || tk.status === 'resolved'
        const canClose = tk.creator_id === meId || !!s.is_staff
        return (
          <Row key={tk.id} icon="ticket-outline" title={tk.title}
            subtitle={`${t(`community.tickets.s.${tk.status}`)} · ${t(`community.tickets.p.${tk.priority}`)}`}
            onPress={() => Alert.alert(tk.title, undefined, [
              ...(tk.channel_id ? [{ text: t('community.tickets.goTo'), onPress: () => goTo(tk.channel_id!) }] : []),
              ...(canClose ? [{ text: t(closed ? 'community.tickets.reopen' : 'community.tickets.close'), onPress: () => setStatus(tk, closed ? 'open' : 'closed') }] : []),
              { text: t('common.cancel'), style: 'cancel' as const },
            ])}
            chevron />
        )
      })}
    </Section>
  )
}
