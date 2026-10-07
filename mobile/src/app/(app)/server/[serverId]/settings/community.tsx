import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { communityApi, type AutoModAdvanced, type LevelSettings, type StarboardSettings, type TicketSettings, type WelcomeSettings } from '@/api/community'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, Section, SwitchRow, T, TextField } from '@/components/ui'
import { parseTags } from '@/features/community/format'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useServerDetail } from '@/features/servers/menus'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

type Api<T> = { get: (sid: string) => Promise<T>; put: (sid: string, v: T) => Promise<unknown> }

/** Réglage chargé, modifié localement puis enregistré (MANAGE_SERVER côté serveur). */
function useForm<T>(sid: string, name: string, api: Api<T>) {
  const t = useT()
  const q = useQuery({ queryKey: ['community', sid, name], queryFn: () => api.get(sid) })
  // Modifications locales par-dessus la valeur du serveur (pas de copie dans un effet).
  const [edit, setEdit] = useState<Partial<T>>({})
  const [saving, setSaving] = useState(false)
  const v: T | null = q.data ? { ...q.data, ...edit } : null
  const save = async (value: T | null = v) => {
    if (!value) return
    setSaving(true)
    try {
      await api.put(sid, value)
      await queryClient.invalidateQueries({ queryKey: ['community', sid] })
      setEdit({})
      Alert.alert(t('community.saved'))
    } catch (e) {
      Alert.alert(t('serverSettings.saveFailed'), errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return { v, set: (patch: Partial<T>) => setEdit((c) => ({ ...c, ...patch })), save, saving }
}

const nums = (values: number[], current: number, label: (n: number) => string) =>
  [...new Set([...values, current])].sort((a, b) => a - b).map((n) => ({ value: n, label: label(n) }))

function Block({ title, footer, children, onSave, saving }: { title: string; footer?: string; children: ReactNode; onSave: () => void; saving: boolean }) {
  const t = useT()
  return (
    <Section title={title} footer={footer}>
      {children}
      <View style={{ padding: spacing.md }}>
        <Button title={t('serverSettings.save')} onPress={onSave} loading={saving} variant="secondary" />
      </View>
    </Section>
  )
}

/** Réglages communauté : annuaire, niveaux, starboard, bienvenue, tickets, AutoMod avancé. */
export default function CommunitySettingsScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const detail = useServerDetail(sid, valid)
  const cats = useQuery({ queryKey: qk.categories(sid), queryFn: () => serversApi.categories(sid), enabled: valid })
  const levels = useForm<LevelSettings>(sid, 'levels', communityApi.levels)
  const star = useForm<StarboardSettings>(sid, 'starboard', communityApi.starboard)
  const welcome = useForm<WelcomeSettings>(sid, 'welcome', communityApi.welcome)
  const tickets = useForm<TicketSettings>(sid, 'tickets/settings', communityApi.ticketSettings)
  const adv = useForm<AutoModAdvanced>(sid, 'automod/advanced', communityApi.automodAdvanced)
  const [tags, setTags] = useState<string | null>(null)
  const [domains, setDomains] = useState<string | null>(null)
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (!detail.data || !levels.v || !star.v || !welcome.v || !tickets.v || !adv.v) return <Loading />

  const textChannels = detail.data.channels.filter((c) => c.type === 'text' || c.type === 'announcement')
  const channelOptions = [{ value: null as string | null, label: t('community.none') }, ...textChannels.map((c) => ({ value: c.id as string | null, label: `#${c.name}` }))]
  const roles = detail.data.roles.filter((r) => !r.is_everyone)
  const serverTags = (detail.data.server as { discovery_tags?: string[] }).discovery_tags ?? []
  const saveTags = () =>
    void communityApi.setTags(sid, parseTags(tags ?? serverTags.join(', ')))
      .then(() => queryClient.invalidateQueries({ queryKey: qk.server(sid) }))
      .then(() => Alert.alert(t('community.saved')), (e) => Alert.alert(t('serverSettings.saveFailed'), errorMessage(e)))

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('community.settings.title') }} />
      <T variant="muted" style={{ marginBottom: spacing.lg }}>{t('community.intro')}</T>

      <Block title={t('community.directory.title')} footer={t('community.directory.desc')} onSave={saveTags} saving={false}>
        <View style={{ padding: spacing.md }}>
          <TextField label={t('community.directory.tags')} value={tags ?? serverTags.join(', ')} onChangeText={setTags} placeholder={t('community.directory.tagsPh')} autoCapitalize="none" maxLength={140} />
        </View>
      </Block>

      <Block title={t('community.levels.title')} footer={t('community.levels.antispam')} onSave={() => void levels.save()} saving={levels.saving}>
        <SwitchRow icon="trophy-outline" title={t('community.levels.title')} subtitle={t('community.levels.desc')} value={levels.v.enabled} onValueChange={(v) => levels.set({ enabled: v })} />
        <ChoiceRow icon="chatbubble-outline" title={t('community.levels.perMessage')} value={levels.v.xp_per_message}
          options={nums([0, 5, 10, 15, 25, 50], levels.v.xp_per_message, String)} onChange={(n) => levels.set({ xp_per_message: n })} />
        <ChoiceRow icon="mic-outline" title={t('community.levels.perVoice')} value={levels.v.xp_per_voice_minute}
          options={nums([0, 5, 10, 20], levels.v.xp_per_voice_minute, String)} onChange={(n) => levels.set({ xp_per_voice_minute: n })} />
      </Block>

      <Block title={t('community.starboard.title')} footer={t('community.starboard.desc')} onSave={() => void star.save()} saving={star.saving}>
        <SwitchRow icon="star-outline" title={t('community.starboard.title')} value={star.v.enabled} onValueChange={(v) => star.set({ enabled: v })} />
        <ChoiceRow icon="chatbubbles-outline" title={t('community.starboard.channel')} value={star.v.channel_id} options={channelOptions} onChange={(c) => star.set({ channel_id: c })} />
        <ChoiceRow icon="happy-outline" title={t('community.starboard.emoji')} value={star.v.emoji}
          options={[...new Set(['⭐', '🔥', '❤️', '👍', '😂', star.v.emoji])].map((e) => ({ value: e, label: e }))} onChange={(e) => star.set({ emoji: e })} />
        <ChoiceRow icon="trending-up-outline" title={t('community.starboard.threshold')} value={star.v.threshold}
          options={nums([1, 2, 3, 5, 10, 20], star.v.threshold, String)} onChange={(n) => star.set({ threshold: n })} />
      </Block>

      <Block title={t('community.welcome.title')} footer={t('community.welcome.vars')} onSave={() => void welcome.save()} saving={welcome.saving}>
        <SwitchRow icon="hand-left-outline" title={t('community.welcome.title')} subtitle={t('community.welcome.desc')} value={welcome.v.enabled} onValueChange={(v) => welcome.set({ enabled: v })} />
        <ChoiceRow icon="chatbubbles-outline" title={t('community.welcome.channel')} value={welcome.v.channel_id} options={channelOptions} onChange={(c) => welcome.set({ channel_id: c })} />
        <View style={{ padding: spacing.md }}>
          <TextField label={t('community.welcome.text')} value={welcome.v.text} onChangeText={(text) => welcome.set({ text })} multiline maxLength={500} />
        </View>
      </Block>

      <Block title={t('community.tickets.title')} footer={t('community.tickets.desc')} onSave={() => void tickets.save()} saving={tickets.saving}>
        <SwitchRow icon="ticket-outline" title={t('community.tickets.title')} value={tickets.v.enabled} onValueChange={(v) => tickets.set({ enabled: v })} />
        <ChoiceRow icon="folder-outline" title={t('community.tickets.category')} value={tickets.v.category_id}
          options={[{ value: null as string | null, label: t('community.none') }, ...(cats.data ?? []).map((c) => ({ value: c.id as string | null, label: c.name }))]}
          onChange={(c) => tickets.set({ category_id: c })} />
        <T variant="label" style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm }}>{t('community.tickets.staff')}</T>
        {roles.map((r) => (
          <SwitchRow key={r.id} title={r.name} value={tickets.v!.staff_role_ids.includes(r.id)}
            onValueChange={(on) => tickets.set({ staff_role_ids: on ? [...tickets.v!.staff_role_ids, r.id] : tickets.v!.staff_role_ids.filter((x) => x !== r.id) })} />
        ))}
      </Block>

      <Block title={t('community.automod.title')} footer={t('community.automod.linksDesc', { n: adv.v.builtin_domains ?? 0 })}
        onSave={() => void adv.save({ ...adv.v!, blocked_domains: (domains ?? adv.v!.blocked_domains.join('\n')).split(/[\s,]+/).filter(Boolean) })} saving={adv.saving}>
        <ChoiceRow icon="speedometer-outline" title={t('community.automod.rate')} value={adv.v.rate_limit_count}
          options={nums([0, 3, 5, 10, 20], adv.v.rate_limit_count, (n) => (n ? t('community.automod.rateValue', { n, s: adv.v!.rate_limit_seconds }) : t('community.off')))}
          onChange={(n) => adv.set({ rate_limit_count: n })} />
        <ChoiceRow icon="people-outline" title={t('community.automod.raid')} value={adv.v.raid_join_count}
          options={nums([0, 5, 10, 20, 50], adv.v.raid_join_count, (n) => (n ? t('community.automod.raidValue', { n, s: adv.v!.raid_join_seconds }) : t('community.off')))}
          onChange={(n) => adv.set({ raid_join_count: n })} />
        <SwitchRow icon="link-outline" title={t('community.automod.blockLinks')} value={adv.v.block_dangerous_links} onValueChange={(v) => adv.set({ block_dangerous_links: v })} />
        <View style={{ padding: spacing.md }}>
          <TextField label={t('community.automod.domains')} value={domains ?? adv.v.blocked_domains.join('\n')} onChangeText={setDomains}
            multiline autoCapitalize="none" placeholder="exemple.com" style={{ minHeight: 70, textAlignVertical: 'top' }} />
        </View>
      </Block>
    </ScrollView>
  )
}
