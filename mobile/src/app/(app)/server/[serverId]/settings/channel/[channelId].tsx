import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { channelsApi, type ChannelFull, type ChannelPatch } from '@/api/channels'
import { forumApi } from '@/api/forum'
import { serversApi } from '@/api/servers'
import { Sheet } from '@/components/Sheet'
import { Button, ErrorState, IconButton, Loading, PasswordField, Row, Section, SwitchRow, T, TextField } from '@/components/ui'
import { ChannelFollows } from '@/features/servers/ChannelFollows'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { ChannelMessagingSection } from '@/features/servers/ChannelMessagingSection'
import { confirmDeleteChannel, useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { supportsWaitingRoom, waitingRoomChange } from '@/features/voice/waitingRoom'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Category } from '@/types/models'
import { colors, spacing } from '@/theme'

type Tr = ReturnType<typeof useT>
const slowmodeLabel = (t: Tr, s: number) =>
  s === 0
    ? t('serverSettings.disabled')
    : s < 60
      ? t('serverSettings.channel.seconds', { n: s })
      : s < 3600
        ? t(s > 60 ? 'serverSettings.channel.minutes' : 'serverSettings.channel.minute', { n: s / 60 })
        : t('serverSettings.dur.1h')
const SLOWMODE = [0, 5, 10, 15, 30, 60, 120, 300, 600, 3600]
const LIMITS = [0, 2, 5, 10, 25, 50, 99]
const BITRATES = [32000, 64000, 96000, 128000, 256000, 384000].map((b) => ({ value: b, label: `${b / 1000} kbps` }))
const SORTS: { value: string; label: Key }[] = [
  { value: 'latest_activity', label: 'serverSettings.channel.sortLatest' },
  { value: 'creation_date', label: 'serverSettings.channel.sortCreated' },
  { value: 'most_replies', label: 'serverSettings.channel.sortReplies' },
  { value: 'most_reactions', label: 'serverSettings.channel.sortReactions' },
]
const PURGES = [50, 100, 500, 1000]
const isVoice = (t: string) => t === 'voice' || t === 'video' || t === 'stage'
const isText = (t: string) => t === 'text' || t === 'announcement' || t === 'forum'

/** Modifier un salon : général, avancé (selon le type), tags de forum, permissions, archivage, purge, suppression. */
export default function EditChannelScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'channelId'] as const)
  const sid = ids.serverId ?? ''
  const channels = useQuery({ queryKey: qk.channels(sid), queryFn: () => serversApi.channels(sid), enabled: valid })
  const categories = useQuery({ queryKey: qk.categories(sid), queryFn: () => serversApi.categories(sid), enabled: valid })
  const channel = channels.data?.find((c) => c.id === ids.channelId) as ChannelFull | undefined
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.channel.invalid')} />
  if (channels.isLoading) return <Loading />
  if (!channel) return <ErrorState message={channels.error ? errorMessage(channels.error) : t('serverSettings.channel.notFound')} />
  return <ChannelForm key={channel.id} serverId={sid} channel={channel} categories={categories.data ?? []} />
}

function ChannelForm({ serverId, channel, categories }: { serverId: string; channel: ChannelFull; categories: Category[] }) {
  const perms = useServerPerms(serverId)
  const t = useT()
  const ty = channel.type
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(channel.category_id)
  const [slowmode, setSlowmode] = useState(channel.slowmode_delay ?? 0)
  const [nsfw, setNsfw] = useState(channel.is_nsfw)
  const [limit, setLimit] = useState(channel.user_limit ?? 0)
  const [bitrate, setBitrate] = useState(channel.bitrate ?? 64000)
  const [password, setPassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [autoCreate, setAutoCreate] = useState(!!channel.is_auto_create)
  const [waitingRoom, setWaitingRoom] = useState(!!channel.waiting_room)
  const [autoName, setAutoName] = useState(channel.auto_create_name ?? '')
  const [sort, setSort] = useState(channel.default_sort || 'latest_activity')
  const [requireTag, setRequireTag] = useState(!!channel.require_tag)
  const [newTag, setNewTag] = useState('')
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tags = useQuery({ queryKey: qk.forumTags(channel.id), queryFn: () => forumApi.tags(channel.id), enabled: ty === 'forum' })
  const refresh = () => Promise.all([qk.channels(serverId), qk.server(serverId)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  const save = async () => {
    const n = name.trim()
    if (n.length < 1 || n.length > 100) return setError(t('serverSettings.channel.nameLength'))
    const patch: ChannelPatch = { name: n, is_nsfw: nsfw }
    if (isText(ty)) Object.assign(patch, { topic: topic.trim(), slowmode_delay: slowmode })
    if (isVoice(ty)) {
      Object.assign(patch, { user_limit: limit || null, bitrate, is_auto_create: autoCreate, auto_create_name: autoName.trim() || null })
      if (removePassword) patch.remove_voice_password = true
      else if (password) patch.voice_password = password
    }
    if (ty === 'forum') Object.assign(patch, { default_sort: sort, require_tag: requireTag })
    setSaving(true)
    setError(null)
    try {
      await channelsApi.update(serverId, channel.id, patch)
      const wr = waitingRoomChange(ty, channel.waiting_room, waitingRoom)
      if (wr !== null) await channelsApi.setWaitingRoom(serverId, channel.id, wr)
      if (categoryId !== channel.category_id) await serversApi.moveChannel(channel.id, categoryId)
      await refresh()
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const act = <R,>(fn: () => Promise<R>, after?: (r: R) => void) =>
    void fn()
      .then(async (r) => {
        await refresh()
        after?.(r)
      })
      .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))

  const addTag = () => {
    if (!newTag.trim()) return
    act(
      () => channelsApi.createTag(channel.id, newTag),
      () => {
        setNewTag('')
        void tags.refetch()
      },
    )
  }

  const purge = (n: number) =>
    Alert.alert(t('serverSettings.channel.purgeTitle', { n }), t('serverSettings.channel.purgeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => act(() => channelsApi.purge(channel.id, n), (r) => Alert.alert(t('serverSettings.channel.purged', { n: r.deleted }))),
      },
    ])

  if (!perms.canEditChannels)
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <T variant="muted">{t('serverSettings.channel.noRight')}</T>
        {perms.canDeleteChannel(channel.created_by) ? (
          <Button title={t('serverSettings.channel.delete')} variant="danger" icon="trash-outline" onPress={() => confirmDeleteChannel(serverId, channel, () => router.back())} />
        ) : null}
      </ScrollView>
    )

  const cats = [...categories].sort((a, b) => a.position - b.position)
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <TextField label={t('serverSettings.channel.name')} value={name} onChangeText={setName} maxLength={100} autoCapitalize="none" />
      {isText(ty) ? <TextField label={t('serverSettings.channel.topic')} value={topic} onChangeText={setTopic} multiline maxLength={1024} style={{ minHeight: 70, textAlignVertical: 'top' }} /> : null}
      {cats.length ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="label">{t('serverSettings.channels.category')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('serverSettings.channels.category')}>
            {[{ id: null, name: t('serverSettings.channel.noCategory') }, ...cats].map((c) => (
              <Button
                key={c.id ?? 'none'}
                title={c.name}
                variant={categoryId === c.id ? 'primary' : 'secondary'}
                onPress={() => setCategoryId(c.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: categoryId === c.id }}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Section title={t('serverSettings.channel.advanced')}>
        {isText(ty) ? (
          <ChoiceRow
            icon="timer-outline"
            title={t('serverSettings.channel.slowmode')}
            value={slowmode}
            options={SLOWMODE.map((s) => ({ value: s, label: slowmodeLabel(t, s) }))}
            onChange={setSlowmode}
          />
        ) : null}
        <SwitchRow icon="warning-outline" title={t('serverSettings.channel.nsfw')} value={nsfw} onValueChange={setNsfw} />
        {isVoice(ty) ? (
          <>
            <ChoiceRow icon="people-outline" title={t('serverSettings.channel.userLimit')}
              value={limit}
              options={LIMITS.map((n) => ({ value: n, label: n ? t('serverSettings.channel.people', { n }) : t('serverSettings.noLimit') }))} onChange={setLimit} />
            <ChoiceRow icon="pulse-outline" title={t('serverSettings.channel.bitrate')} value={bitrate} options={BITRATES} onChange={setBitrate} />
            <SwitchRow icon="add-circle-outline" title={t('serverSettings.channel.autoCreate')} value={autoCreate} onValueChange={setAutoCreate} />
            {supportsWaitingRoom(ty) ? <SwitchRow icon="hourglass-outline" title={t('waiting.setting')} subtitle={t('waiting.settingHint')} value={waitingRoom} onValueChange={setWaitingRoom} /> : null}
          </>
        ) : null}
        {ty === 'forum' ? (
          <>
            <ChoiceRow icon="swap-vertical-outline" title={t('serverSettings.channel.defaultSort')} value={sort} options={SORTS.map((o) => ({ ...o, label: t(o.label) }))} onChange={setSort} />
            <SwitchRow icon="pricetag-outline" title={t('serverSettings.channel.requireTag')} value={requireTag} onValueChange={setRequireTag} />
          </>
        ) : null}
      </Section>
      {ty === 'text' || ty === 'announcement' ? (
        <ChannelMessagingSection serverId={serverId} channelId={channel.id} disappearSeconds={channel.disappear_seconds} autoThreads={channel.auto_threads} />
      ) : null}
      {isVoice(ty) && autoCreate ? (
        <TextField label={t('serverSettings.channel.autoName')} value={autoName} onChangeText={setAutoName} maxLength={100} placeholder={t('serverSettings.channel.autoNamePlaceholder')} />
      ) : null}
      {isVoice(ty) ? (
        <View style={{ gap: spacing.sm }}>
          {channel.has_voice_password ? (
            <SwitchRow icon="lock-open-outline" title={t('serverSettings.channel.removePassword')} value={removePassword} onValueChange={setRemovePassword} />
          ) : null}
          {removePassword ? null : (
            <PasswordField
              label={t(channel.has_voice_password ? 'serverSettings.channel.newPassword' : 'serverSettings.channel.passwordOptional')}
              value={password}
              onChangeText={setPassword}
              maxLength={100}
            />
          )}
        </View>
      ) : null}
      {error ? <T variant="error">{error}</T> : null}
      <Button title={t('serverSettings.save')} onPress={save} loading={saving} />

      {ty === 'forum' ? (
        <Section title={t('serverSettings.channel.forumTags')} footer={t('serverSettings.channel.forumTagsFooter')}>
          {(tags.data ?? []).map((tag) => (
            <Row
              key={tag}
              icon="pricetag-outline"
              title={tag}
              right={
                <IconButton
                  icon="trash-outline"
                  label={t('serverSettings.channel.deleteTag', { name: tag })}
                  color={colors.danger}
                  onPress={() => act(() => channelsApi.deleteTag(channel.id, tag), () => void tags.refetch())}
                />
              }
            />
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField value={newTag} onChangeText={setNewTag} placeholder={t('serverSettings.channel.newTag')} accessibilityLabel={t('serverSettings.channel.newTag')} maxLength={32} onSubmitEditing={addTag} />
            </View>
            <IconButton icon="add" label={t('serverSettings.channel.addTag')} onPress={addTag} />
          </View>
        </Section>
      ) : null}

      {ty === 'text' || ty === 'announcement' ? <ChannelFollows channelId={channel.id} isAnnouncement={ty === 'announcement'} /> : null}

      <Section>
        <Row
          icon="lock-closed-outline"
          title={t('serverSettings.channel.perms')}
          subtitle={t('serverSettings.channel.permsSub')}
          chevron
          onPress={() => router.push({ pathname: '/server/[serverId]/settings/channel-perms/[channelId]', params: { serverId, channelId: channel.id } })}
        />
        <Row
          icon={channel.archived ? 'archive' : 'archive-outline'}
          title={t(channel.archived ? 'serverSettings.channel.restore' : 'serverSettings.channel.archive')}
          subtitle={channel.archived ? t('serverSettings.channel.archivedSub') : null}
          onPress={() => act(() => channelsApi.toggleArchive(serverId, channel.id), () => router.back())}
        />
        {perms.has(PERM.MANAGE_CHANNELS) && isText(ty) && ty !== 'forum' ? (
          <Row icon="flame-outline" title={t('serverSettings.channel.purge')} danger onPress={() => setPurgeOpen(true)} />
        ) : null}
      </Section>
      {perms.canDeleteChannel(channel.created_by) ? (
        <Button title={t('serverSettings.channel.delete')} variant="danger" icon="trash-outline" onPress={() => confirmDeleteChannel(serverId, channel, () => router.back())} />
      ) : null}
      <Sheet
        visible={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title={t('serverSettings.channel.purgeSheet')}
        actions={PURGES.map((n) => ({ label: t('serverSettings.channel.purgeLast', { n }), icon: 'flame-outline', danger: true, onPress: () => purge(n) }))}
      />
    </ScrollView>
  )
}
