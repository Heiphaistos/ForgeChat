import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { memo, useCallback, useMemo, useState } from 'react'
import { Alert, FlatList, Linking, Pressable, View } from 'react-native'
import { discordSyncApi } from '@/api/discordSync'
import { Button, ErrorState, Loading, PasswordField, Row, Section, SwitchRow, T, TextField } from '@/components/ui'
import {
  buildPutBody,
  canManageDiscordSync,
  canSave,
  canUnlinkDiscordSync,
  formFromConfig,
  isGuildId,
  syncError,
  type SyncConfig,
  type SyncForm,
} from '@/features/servers/discordSync'
import {
  categoryState,
  counts,
  filterTree,
  flattenTree,
  initialSelection,
  invertSelection,
  selectAll,
  selectNone,
  toggleCategory,
  toggleChannel,
  type CheckState,
  type SyncTree,
  type TreeCategory,
  type TreeRow,
} from '@/features/servers/discordSyncTree'
import { useServerDetail, useServerPerms } from '@/features/servers/menus'
import { useT, type Key } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const KIND_ICON = {
  text: 'chatbox-outline',
  voice: 'volume-high-outline',
  announcement: 'megaphone-outline',
  stage: 'mic-outline',
  forum: 'albums-outline',
  media: 'image-outline',
} as const

const tick = <Ionicons name="checkmark" size={20} color={colors.primary} />

/** Case à cocher accessible ; « some » = catégorie partiellement cochée (état « mixed »). */
const Check = memo(function Check({ state, label, onToggle }: { state: CheckState; label: string; onToggle: () => void }) {
  const t = useT()
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityValue={{ text: t(`dsync.checkbox.${state}` as Key) }}
      accessibilityState={{ checked: state === 'some' ? 'mixed' : state === 'all' }}
    >
      <Ionicons
        name={state === 'all' ? 'checkbox' : state === 'some' ? 'remove-circle' : 'square-outline'}
        size={24}
        color={state === 'none' ? colors.textMuted : colors.primary}
      />
    </Pressable>
  )
})

/** Synchro Discord (MANAGE_SERVER ; délier = propriétaire). Le jeton n'est jamais réaffiché et le champ est vidé dès l'envoi. */
export default function DiscordSyncScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const t = useT()
  const qc = useQueryClient()
  const detail = useServerDetail(sid, valid)
  const perms = useServerPerms(sid, valid)
  const allowed = canManageDiscordSync(perms)
  const q = useQuery({
    queryKey: qk.discordSync(sid),
    queryFn: () => discordSyncApi.get(sid),
    enabled: valid && allowed,
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false),
  })
  const cfg = q.data
  const [edits, setEdits] = useState<Partial<SyncForm>>({})
  const [tree, setTree] = useState<SyncTree | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())

  // Formulaire = configuration enregistrée + modifications locales (remises à zéro après « Délier »).
  const form: SyncForm | null = cfg ? { ...formFromConfig(cfg), ...edits } : null

  const fail = (e: unknown) => Alert.alert(t('dsync.failed'), syncError(e))
  const patch = (p: Partial<SyncForm>) => setEdits((e) => ({ ...e, ...p }))

  const save = useMutation({
    mutationFn: () => discordSyncApi.put(sid, buildPutBody(form as SyncForm, cfg?.excludedCategories ?? [], tree, sel)),
    onSuccess: (data: SyncConfig) => {
      patch({ token: '' })
      qc.setQueryData(qk.discordSync(sid), data)
      Alert.alert(data.guildName ? t('dsync.savedGuild', { name: data.guildName }) : t('dsync.saved'))
    },
    onError: (e) => {
      patch({ token: '' })
      fail(e)
    },
  })
  const loadTree = useMutation({
    mutationFn: () => discordSyncApi.tree(sid),
    onSuccess: (data) => {
      setTree(data)
      setSel(initialSelection(data))
    },
    onError: (e) => Alert.alert(t('dsync.treeError'), syncError(e)),
  })
  const run = useMutation({
    mutationFn: () => discordSyncApi.run(sid),
    onSuccess: () => {
      Alert.alert(t('dsync.started'))
      qc.setQueryData<SyncConfig>(qk.discordSync(sid), (old) => (old ? { ...old, running: true } : old))
      setTimeout(() => void qc.invalidateQueries({ queryKey: qk.discordSync(sid) }), 1500)
    },
    onError: fail,
  })
  const unlink = useMutation({
    mutationFn: () => discordSyncApi.remove(sid),
    onSuccess: () => {
      Alert.alert(t('dsync.unlinked'))
      setEdits({})
      setTree(null)
      void qc.invalidateQueries({ queryKey: qk.discordSync(sid) })
    },
    onError: fail,
  })
  const confirmUnlink = () =>
    Alert.alert(t('dsync.unlink'), t('dsync.unlinkConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('dsync.unlink'), style: 'destructive', onPress: () => unlink.mutate() },
    ])

  const searching = query.trim() !== ''
  const shown = useMemo(() => (tree ? filterTree(tree, query) : null), [tree, query])
  const rows = useMemo(() => (shown ? flattenTree(shown, closed, searching) : []), [shown, closed, searching])
  // Les bascules partent toujours de l'arbre complet (le filtre réduit les salons d'une catégorie).
  const full = useCallback((cat: TreeCategory) => tree?.categories.find((c) => c.id === cat.id) ?? cat, [tree])
  const toggleOpen = useCallback(
    (id: string) =>
      setClosed((p) => {
        const n = new Set(p)
        if (n.has(id)) n.delete(id)
        else n.add(id)
        return n
      }),
    [],
  )

  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (detail.isLoading || !perms.loaded) return <Loading />
  if (!allowed) return <ErrorState message={t('error.forbidden')} />
  if (q.isLoading) return <Loading />
  if (q.error || !cfg || !form) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const guildOk = isGuildId(form.guildId)
  const c = tree ? counts(tree, sel) : null
  let status = t('dsync.never')
  if (cfg.lastSyncAt) {
    const vars = { when: formatShort(cfg.lastSyncAt), n: cfg.lastImported }
    status = cfg.lastStatus === 'error' ? t('dsync.statusError', vars) : cfg.lastStatus === 'partial' ? t('dsync.statusPartial', vars) : t('dsync.statusOk', vars)
  }
  const detailLine = cfg.running
    ? null
    : [cfg.lastError, cfg.enabled && cfg.nextSyncAt ? t('dsync.next', { when: formatShort(cfg.nextSyncAt) }) : null].filter(Boolean).join('\n') || null

  const header = (
    <View style={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <T variant="muted">{t('dsync.intro')}</T>
        <T variant="small">{t('dsync.howto')}</T>
        <Button title={t('dsync.portal')} variant="ghost" icon="open-outline" onPress={() => void Linking.openURL('https://discord.com/developers/applications')} />
      </View>
      <Section title={t('dsync.status')}>
        <Row
          icon={cfg.running ? 'sync-outline' : cfg.lastStatus === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
          title={cfg.running ? t('dsync.running') : status}
          subtitle={detailLine}
        />
      </Section>
      <TextField
        label={t('dsync.guildId')}
        value={form.guildId}
        onChangeText={(v) => patch({ guildId: v })}
        placeholder={t('dsync.guildIdPh')}
        accessibilityLabel={t('dsync.guildId')}
        keyboardType="number-pad"
        maxLength={21}
        autoCorrect={false}
        error={form.guildId && !guildOk ? t('dsync.guildInvalid') : null}
      />
      <View style={{ gap: 4 }}>
        <PasswordField
          label={t('dsync.token')}
          value={form.token}
          onChangeText={(v) => patch({ token: v })}
          placeholder={t('dsync.tokenPh')}
          accessibilityLabel={t('dsync.tokenA11y')}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
        />
        {cfg.hasToken ? <T variant="small">{t('dsync.tokenKeep')}</T> : null}
        {form.enabled && !cfg.hasToken && !form.token.trim() ? <T variant="error">{t('dsync.tokenNeeded')}</T> : null}
      </View>
      <Section>
        <SwitchRow title={t('dsync.enabled')} value={form.enabled} onValueChange={(v) => patch({ enabled: v })} />
        <SwitchRow title={t('dsync.emojis')} value={form.syncEmojis} onValueChange={(v) => patch({ syncEmojis: v })} />
      </Section>
      <Section title={t('dsync.interval')}>
        <Row title={t('dsync.daily')} selected={form.intervalHours === 24} onPress={() => patch({ intervalHours: 24 })} right={form.intervalHours === 24 ? tick : undefined} />
        <Row title={t('dsync.every2')} selected={form.intervalHours === 48} onPress={() => patch({ intervalHours: 48 })} right={form.intervalHours === 48 ? tick : undefined} />
      </Section>
      <Section title={t('dsync.mode')}>
        {(['full', 'content'] as const).map((m) => (
          <Row
            key={m}
            title={t(m === 'full' ? 'dsync.modeFull' : 'dsync.modeContent')}
            subtitle={t(m === 'full' ? 'dsync.modeFullHint' : 'dsync.modeContentHint')}
            selected={form.syncMode === m}
            onPress={() => patch({ syncMode: m })}
            right={form.syncMode === m ? tick : undefined}
          />
        ))}
      </Section>
      <Section title={t('dsync.items')} footer={t('dsync.itemsHint')}>
        <SwitchRow title={t('dsync.autoNew')} subtitle={t('dsync.autoNewHint')} value={form.autoIncludeNew} onValueChange={(v) => patch({ autoIncludeNew: v })} />
      </Section>
      {cfg.hasToken ? (
        <Button
          title={loadTree.isPending ? t('dsync.loading') : tree ? t('dsync.reloadTree') : t('dsync.loadTree')}
          variant="secondary"
          icon="git-branch-outline"
          loading={loadTree.isPending}
          onPress={() => loadTree.mutate()}
        />
      ) : (
        <T variant="small">{t('dsync.treeNeedsToken')}</T>
      )}
      {tree && c ? (
        <View style={{ gap: spacing.sm }}>
          <TextField value={query} onChangeText={setQuery} placeholder={t('dsync.treeSearch')} accessibilityLabel={t('dsync.treeSearch')} maxLength={100} autoCorrect={false} returnKeyType="search" />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button title={t('dsync.selectAll')} variant="secondary" style={{ flex: 1 }} onPress={() => setSel(selectAll(tree))} />
            <Button title={t('dsync.selectNone')} variant="secondary" style={{ flex: 1 }} onPress={() => setSel(selectNone())} />
            <Button title={t('dsync.invert')} variant="secondary" style={{ flex: 1 }} onPress={() => setSel(invertSelection(tree, sel))} />
          </View>
          <View accessibilityLiveRegion="polite">
            <T variant="label">{t('dsync.count', { n: c.selected, total: c.total })}</T>
          </View>
          {rows.length === 0 ? <T variant="muted">{t('dsync.treeEmpty')}</T> : null}
        </View>
      ) : null}
    </View>
  )

  const owner = canUnlinkDiscordSync(perms)
  const footer = (
    <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
      <T variant="small">{t('dsync.e2eNote')}</T>
      <Button title={save.isPending ? t('dsync.saving') : t('dsync.save')} icon="save-outline" disabled={!canSave(form, cfg.hasToken)} loading={save.isPending} onPress={() => save.mutate()} />
      {cfg.hasToken ? <Button title={t('dsync.syncNow')} variant="secondary" icon="sync-outline" disabled={cfg.running} loading={run.isPending} onPress={() => run.mutate()} /> : null}
      {cfg.configured && owner ? <Button title={t('dsync.unlink')} variant="danger" icon="unlink-outline" loading={unlink.isPending} onPress={confirmUnlink} /> : null}
      {cfg.configured && !owner ? <T variant="small">{t('dsync.unlinkOwnerOnly')}</T> : null}
    </View>
  )

  const renderRow = ({ item }: { item: TreeRow }) => {
    if (item.type === 'category') {
      const cat = full(item.cat)
      const st = categoryState(cat, sel)
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
          <Pressable
            onPress={() => toggleOpen(cat.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t(item.open ? 'dsync.collapse' : 'dsync.expand', { name: cat.name })}
            accessibilityState={{ expanded: item.open }}
          >
            <Ionicons name={item.open ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.textMuted} />
          </Pressable>
          <Check state={st} label={cat.name} onToggle={() => setSel(toggleCategory(cat, sel, st !== 'all'))} />
          <View style={{ flex: 1 }}>
            <T variant="label" numberOfLines={1}>
              {cat.name}
            </T>
          </View>
        </View>
      )
    }
    const parent = item.catId ? (tree?.categories.find((x) => x.id === item.catId) ?? null) : null
    const on = sel.has(item.ch.id)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingLeft: item.catId ? spacing.xl : 0 }}>
        <Check state={on ? 'all' : 'none'} label={item.ch.name} onToggle={() => setSel(toggleChannel(parent, item.ch.id, sel, !on))} />
        <Ionicons name={KIND_ICON[item.ch.kind] ?? 'chatbox-outline'} size={16} color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          <T numberOfLines={1}>{item.ch.name}</T>
        </View>
        <T variant="small">{t(`dsync.kind.${item.ch.kind}` as Key)}</T>
      </View>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: t('dsync.title') }} />
      <FlatList
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: spacing.lg }}
        data={rows}
        keyExtractor={(r) => (r.type === 'category' ? `c${r.cat.id}` : `h${r.ch.id}`)}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        extraData={sel}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={7}
      />
    </>
  )
}
