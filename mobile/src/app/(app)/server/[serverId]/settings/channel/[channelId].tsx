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
import { confirmDeleteChannel, useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Category } from '@/types/models'
import { colors, spacing } from '@/theme'

const SLOWMODE = [0, 5, 10, 15, 30, 60, 120, 300, 600, 3600].map((s) => ({
  value: s,
  label: s === 0 ? 'Désactivé' : s < 60 ? `${s} secondes` : s < 3600 ? `${s / 60} minute${s > 60 ? 's' : ''}` : '1 heure',
}))
const LIMITS = [0, 2, 5, 10, 25, 50, 99].map((n) => ({ value: n, label: n ? `${n} personnes` : 'Sans limite' }))
const BITRATES = [32000, 64000, 96000, 128000, 256000, 384000].map((b) => ({ value: b, label: `${b / 1000} kbps` }))
const SORTS = [
  { value: 'latest_activity', label: 'Dernière activité' },
  { value: 'creation_date', label: 'Date de création' },
  { value: 'most_replies', label: 'Nombre de réponses' },
  { value: 'most_reactions', label: 'Nombre de réactions' },
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
  if (!valid) return <ErrorState message="Salon invalide." />
  if (channels.isLoading) return <Loading />
  if (!channel) return <ErrorState message={channels.error ? errorMessage(channels.error) : 'Salon introuvable.'} />
  return <ChannelForm key={channel.id} serverId={sid} channel={channel} categories={categories.data ?? []} />
}

function ChannelForm({ serverId, channel, categories }: { serverId: string; channel: ChannelFull; categories: Category[] }) {
  const perms = useServerPerms(serverId)
  const t = channel.type
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
  const [autoName, setAutoName] = useState(channel.auto_create_name ?? '')
  const [sort, setSort] = useState(channel.default_sort || 'latest_activity')
  const [requireTag, setRequireTag] = useState(!!channel.require_tag)
  const [newTag, setNewTag] = useState('')
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tags = useQuery({ queryKey: qk.forumTags(channel.id), queryFn: () => forumApi.tags(channel.id), enabled: t === 'forum' })
  const refresh = () => Promise.all([qk.channels(serverId), qk.server(serverId)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))

  const save = async () => {
    const n = name.trim()
    if (n.length < 1 || n.length > 100) return setError('Le nom doit faire entre 1 et 100 caractères.')
    const patch: ChannelPatch = { name: n, is_nsfw: nsfw }
    if (isText(t)) Object.assign(patch, { topic: topic.trim(), slowmode_delay: slowmode })
    if (isVoice(t)) {
      Object.assign(patch, { user_limit: limit || null, bitrate, is_auto_create: autoCreate, auto_create_name: autoName.trim() || null })
      if (removePassword) patch.remove_voice_password = true
      else if (password) patch.voice_password = password
    }
    if (t === 'forum') Object.assign(patch, { default_sort: sort, require_tag: requireTag })
    setSaving(true)
    setError(null)
    try {
      await channelsApi.update(serverId, channel.id, patch)
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
      .catch((e) => Alert.alert('Action impossible', errorMessage(e)))

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
    Alert.alert(`Supprimer les ${n} derniers messages ?`, 'Action définitive.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => act(() => channelsApi.purge(channel.id, n), (r) => Alert.alert(`${r.deleted} messages supprimés`)) },
    ])

  if (!perms.canEditChannels)
    return (
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }}>
        <T variant="muted">Tu n’as pas le droit de modifier ce salon.</T>
        {perms.canDeleteChannel(channel.created_by) ? (
          <Button title="Supprimer le salon" variant="danger" icon="trash-outline" onPress={() => confirmDeleteChannel(serverId, channel, () => router.back())} />
        ) : null}
      </ScrollView>
    )

  const cats = [...categories].sort((a, b) => a.position - b.position)
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <TextField label="Nom du salon" value={name} onChangeText={setName} maxLength={100} autoCapitalize="none" />
      {isText(t) ? <TextField label="Sujet" value={topic} onChangeText={setTopic} multiline maxLength={1024} style={{ minHeight: 70, textAlignVertical: 'top' }} /> : null}
      {cats.length ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="label">Catégorie</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Catégorie">
            {[{ id: null, name: 'Aucune' }, ...cats].map((c) => (
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
      <Section title="Avancé">
        {isText(t) ? <ChoiceRow icon="timer-outline" title="Mode lent" value={slowmode} options={SLOWMODE} onChange={setSlowmode} /> : null}
        <SwitchRow icon="warning-outline" title="Salon NSFW (18+)" value={nsfw} onValueChange={setNsfw} />
        {isVoice(t) ? (
          <>
            <ChoiceRow icon="people-outline" title="Limite d'utilisateurs" value={limit} options={LIMITS} onChange={setLimit} />
            <ChoiceRow icon="pulse-outline" title="Débit audio" value={bitrate} options={BITRATES} onChange={setBitrate} />
            <SwitchRow icon="add-circle-outline" title="Créer un salon temporaire en rejoignant" value={autoCreate} onValueChange={setAutoCreate} />
          </>
        ) : null}
        {t === 'forum' ? (
          <>
            <ChoiceRow icon="swap-vertical-outline" title="Tri par défaut" value={sort} options={SORTS} onChange={setSort} />
            <SwitchRow icon="pricetag-outline" title="Tag obligatoire" value={requireTag} onValueChange={setRequireTag} />
          </>
        ) : null}
      </Section>
      {isVoice(t) && autoCreate ? (
        <TextField label="Nom des salons créés" value={autoName} onChangeText={setAutoName} maxLength={100} placeholder="Salon de {username}" />
      ) : null}
      {isVoice(t) ? (
        <View style={{ gap: spacing.sm }}>
          {channel.has_voice_password ? (
            <SwitchRow icon="lock-open-outline" title="Retirer le mot de passe" value={removePassword} onValueChange={setRemovePassword} />
          ) : null}
          {removePassword ? null : (
            <PasswordField
              label={channel.has_voice_password ? 'Nouveau mot de passe vocal' : 'Mot de passe vocal (facultatif)'}
              value={password}
              onChangeText={setPassword}
              maxLength={100}
            />
          )}
        </View>
      ) : null}
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Enregistrer" onPress={save} loading={saving} />

      {t === 'forum' ? (
        <Section title="Tags du forum" footer="20 tags au plus, 32 caractères chacun.">
          {(tags.data ?? []).map((tag) => (
            <Row
              key={tag}
              icon="pricetag-outline"
              title={tag}
              right={
                <IconButton
                  icon="trash-outline"
                  label={`Supprimer le tag ${tag}`}
                  color={colors.danger}
                  onPress={() => act(() => channelsApi.deleteTag(channel.id, tag), () => void tags.refetch())}
                />
              }
            />
          ))}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <TextField value={newTag} onChangeText={setNewTag} placeholder="Nouveau tag" accessibilityLabel="Nouveau tag" maxLength={32} onSubmitEditing={addTag} />
            </View>
            <IconButton icon="add" label="Ajouter le tag" onPress={addTag} />
          </View>
        </Section>
      ) : null}

      {t === 'text' || t === 'announcement' ? <ChannelFollows channelId={channel.id} isAnnouncement={t === 'announcement'} /> : null}

      <Section>
        <Row
          icon="lock-closed-outline"
          title="Permissions du salon"
          subtitle="Autoriser ou refuser par rôle ou par membre"
          chevron
          onPress={() => router.push({ pathname: '/server/[serverId]/settings/channel-perms/[channelId]', params: { serverId, channelId: channel.id } })}
        />
        <Row
          icon={channel.archived ? 'archive' : 'archive-outline'}
          title={channel.archived ? 'Restaurer le salon' : 'Archiver le salon'}
          subtitle={channel.archived ? 'Archivé : masqué de la liste des salons' : null}
          onPress={() => act(() => channelsApi.toggleArchive(serverId, channel.id), () => router.back())}
        />
        {perms.has(PERM.MANAGE_CHANNELS) && isText(t) && t !== 'forum' ? (
          <Row icon="flame-outline" title="Purger des messages" danger onPress={() => setPurgeOpen(true)} />
        ) : null}
      </Section>
      {perms.canDeleteChannel(channel.created_by) ? (
        <Button title="Supprimer le salon" variant="danger" icon="trash-outline" onPress={() => confirmDeleteChannel(serverId, channel, () => router.back())} />
      ) : null}
      <Sheet
        visible={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title="Purger les derniers messages"
        actions={PURGES.map((n) => ({ label: `Les ${n} derniers`, icon: 'flame-outline', danger: true, onPress: () => purge(n) }))}
      />
    </ScrollView>
  )
}
