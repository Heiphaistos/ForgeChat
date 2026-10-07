import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { serversApi, type ServerFull } from '@/api/servers'
import { Button, ErrorState, Loading, Section, SwitchRow, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useServerDetail } from '@/features/servers/menus'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Channel } from '@/types/models'
import { colors, spacing } from '@/theme'

// Mêmes valeurs que le web (ServerSettingsModal.tsx), en secondes.
const AFK_TIMEOUTS = [60, 120, 300, 600, 900, 1800, 3600]
const FILTERS: { value: string; label: Key }[] = [
  { value: 'none', label: 'serverSettings.disabled' },
  { value: 'no_role', label: 'serverSettings.adv.filterNoRole' },
  { value: 'all', label: 'serverSettings.adv.filterAll' },
]
const VANITY = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/** Réglages avancés (propriétaire) : visibilité, bienvenue, salons système, AFK, filtre, adresse, vérification, modèle. */
export default function AdvancedSettingsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const detail = useServerDetail(ids.serverId ?? '', valid)
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (detail.isLoading) return <Loading />
  if (!detail.data) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
  const server = detail.data.server as ServerFull
  return <AdvancedForm key={server.id} server={server} channels={detail.data.channels} />
}

function AdvancedForm({ server, channels }: { server: ServerFull; channels: Channel[] }) {
  const [isPublic, setPublic] = useState(server.is_public)
  const [welcome, setWelcome] = useState(server.welcome_message ?? '')
  const [systemId, setSystemId] = useState(server.system_channel_id)
  const [rulesId, setRulesId] = useState(server.rules_channel_id)
  const [afkId, setAfkId] = useState(server.afk_channel_id)
  const [afkTimeout, setAfkTimeout] = useState(server.afk_timeout_minutes || 300)
  const [filter, setFilter] = useState(server.content_filter || 'none')
  const [vanity, setVanity] = useState(server.vanity_url ?? '')
  const [verif, setVerif] = useState(server.verification_enabled)
  const [rules, setRules] = useState(server.verification_rules ?? '')
  const [template, setTemplate] = useState('')
  const [templatePublic, setTemplatePublic] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const t = useT()

  const none = { value: null, label: t('serverSettings.none') }
  const text = [none, ...channels.filter((c) => c.type === 'text' || c.type === 'announcement').map((c) => ({ value: c.id as string | null, label: `# ${c.name}` }))]
  const voice = [none, ...channels.filter((c) => c.type === 'voice' || c.type === 'video').map((c) => ({ value: c.id as string | null, label: c.name }))]

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await Promise.all([qk.servers, qk.server(server.id)].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      Alert.alert(done)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const save = () => {
    const v = vanity.trim().toLowerCase()
    if (v && !VANITY.test(v)) return setError(t('serverSettings.adv.vanityInvalid'))
    void run(
      'save',
      () =>
        serversApi.update(server.id, {
          is_public: isPublic,
          welcome_message: welcome.trim(), // chaîne vide pour vider : le serveur fait COALESCE
          system_channel_id: systemId,
          rules_channel_id: rulesId,
          afk_channel_id: afkId,
          afk_timeout: afkTimeout,
          content_filter: filter,
          vanity_url: v || null,
        }),
      t('serverSettings.adv.saved'),
    )
  }

  const saveTemplate = () => {
    if (template.trim().length < 2) return setError(t('serverSettings.adv.templateNameLength'))
    void run('template', () => serversApi.saveTemplate(server.id, template, templatePublic).then(() => setTemplate('')), t('serverSettings.adv.templateSaved'))
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('serverSettings.title.advanced') }} />
      <Section title={t('serverSettings.adv.visibility')} footer={t('serverSettings.adv.visibilityFooter')}>
        <SwitchRow icon="globe-outline" title={t('serverSettings.adv.public')} value={isPublic} onValueChange={setPublic} />
        <ChoiceRow icon="eye-off-outline" title={t('serverSettings.adv.filter')} value={filter} options={FILTERS.map((o) => ({ ...o, label: t(o.label) }))} onChange={setFilter} />
      </Section>
      <Section title={t('serverSettings.channelsLabel')}>
        <ChoiceRow icon="megaphone-outline" title={t('serverSettings.adv.system')} value={systemId} options={text} onChange={setSystemId} />
        <ChoiceRow icon="book-outline" title={t('serverSettings.adv.rules')} value={rulesId} options={text} onChange={setRulesId} />
        <ChoiceRow icon="moon-outline" title={t('serverSettings.adv.afk')} value={afkId} options={voice} onChange={setAfkId} />
        {afkId ? <ChoiceRow icon="timer-outline" title={t('serverSettings.adv.afkTimeout')}
            value={afkTimeout}
            options={AFK_TIMEOUTS.map((s) => ({ value: s, label: s >= 3600 ? t('serverSettings.dur.1h') : t('serverSettings.adv.min', { n: s / 60 }) }))} onChange={setAfkTimeout} /> : null}
      </Section>
      <Section title={t('serverSettings.adv.welcomeSection')}>
        <TextField
          value={welcome}
          onChangeText={setWelcome}
          placeholder={t('serverSettings.adv.welcome')}
          accessibilityLabel={t('serverSettings.adv.welcome')}
          multiline
          maxLength={2000}
          style={{ minHeight: 80, textAlignVertical: 'top', borderRadius: 0 }}
        />
      </Section>
      <Section title={t('serverSettings.adv.vanity')} footer={t('serverSettings.adv.vanityFooter')}>
        <TextField
          value={vanity}
          onChangeText={(v) => setVanity(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder={t('serverSettings.adv.vanityPlaceholder')}
          accessibilityLabel={t('serverSettings.adv.vanity')}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          style={{ borderRadius: 0 }}
        />
      </Section>
      {error ? <T variant="error" style={{ marginBottom: spacing.md }}>{error}</T> : null}
      <Button title={t('serverSettings.save')} onPress={save} loading={busy === 'save'} style={{ marginBottom: spacing.xl }} />

      <Section title={t('serverSettings.adv.verifGate')} footer={t('serverSettings.adv.verifFooter')}>
        <SwitchRow icon="checkmark-circle-outline" title={t('serverSettings.adv.verifOnJoin')} value={verif} onValueChange={setVerif} />
        {verif ? (
          <TextField
            value={rules}
            onChangeText={setRules}
            placeholder={t('serverSettings.adv.rulesToAccept')}
            accessibilityLabel={t('serverSettings.adv.rulesToAccept')}
            multiline
            maxLength={2000}
            style={{ minHeight: 100, textAlignVertical: 'top', borderRadius: 0 }}
          />
        ) : null}
      </Section>
      <Button
        title={t('serverSettings.adv.saveVerif')}
        variant="secondary"
        loading={busy === 'verif'}
        onPress={() => void run('verif', () => serversApi.updateVerification(server.id, verif, rules.trim() || null), t('serverSettings.adv.verifSaved'))}
        style={{ marginBottom: spacing.xl }}
      />

      <Section title={t('serverSettings.adv.template')} footer={t('serverSettings.adv.templateFooter')}>
        <TextField value={template} onChangeText={setTemplate} placeholder={t('serverSettings.adv.templateName')} accessibilityLabel={t('serverSettings.adv.templateName')} maxLength={100} style={{ borderRadius: 0 }} />
        <SwitchRow title={t('serverSettings.adv.templatePublic')} value={templatePublic} onValueChange={setTemplatePublic} />
      </Section>
      <Button title={t('serverSettings.adv.saveAsTemplate')} variant="secondary" icon="copy-outline" loading={busy === 'template'} onPress={saveTemplate} />
    </ScrollView>
  )
}
