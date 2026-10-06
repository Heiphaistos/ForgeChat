import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { serversApi, type ServerFull } from '@/api/servers'
import { Button, ErrorState, Loading, Section, SwitchRow, T, TextField } from '@/components/ui'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useServerDetail } from '@/features/servers/menus'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Channel } from '@/types/models'
import { colors, spacing } from '@/theme'

// Mêmes valeurs que le web (ServerSettingsModal.tsx), en secondes.
const AFK_TIMEOUTS = [60, 120, 300, 600, 900, 1800, 3600].map((t) => ({ value: t, label: t >= 3600 ? '1 heure' : `${t / 60} min` }))
const FILTERS = [
  { value: 'none', label: 'Désactivé' },
  { value: 'no_role', label: 'Membres sans rôle' },
  { value: 'all', label: 'Tous les membres' },
]
const VANITY = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

/** Réglages avancés (propriétaire) : visibilité, bienvenue, salons système, AFK, filtre, adresse, vérification, modèle. */
export default function AdvancedSettingsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const detail = useServerDetail(ids.serverId ?? '', valid)
  if (!valid) return <ErrorState message="Serveur invalide." />
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

  const none = { value: null, label: 'Aucun' }
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
    if (v && !VANITY.test(v)) return setError('Adresse personnalisée : 3 à 30 caractères, minuscules, chiffres et tirets (pas en bord).')
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
      'Réglages enregistrés',
    )
  }

  const saveTemplate = () => {
    if (template.trim().length < 2) return setError('Nom du modèle : 2 à 100 caractères.')
    void run('template', () => serversApi.saveTemplate(server.id, template, templatePublic).then(() => setTemplate('')), 'Modèle enregistré')
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Réglages avancés' }} />
      <Section title="Visibilité" footer="Un serveur public apparaît dans « Explorer ».">
        <SwitchRow icon="globe-outline" title="Serveur public" value={isPublic} onValueChange={setPublic} />
        <ChoiceRow icon="eye-off-outline" title="Filtre de contenu" value={filter} options={FILTERS} onChange={setFilter} />
      </Section>
      <Section title="Salons">
        <ChoiceRow icon="megaphone-outline" title="Salon système" value={systemId} options={text} onChange={setSystemId} />
        <ChoiceRow icon="book-outline" title="Salon des règles" value={rulesId} options={text} onChange={setRulesId} />
        <ChoiceRow icon="moon-outline" title="Salon AFK" value={afkId} options={voice} onChange={setAfkId} />
        {afkId ? <ChoiceRow icon="timer-outline" title="Délai AFK" value={afkTimeout} options={AFK_TIMEOUTS} onChange={setAfkTimeout} /> : null}
      </Section>
      <Section title="Accueil">
        <TextField
          value={welcome}
          onChangeText={setWelcome}
          placeholder="Message de bienvenue"
          accessibilityLabel="Message de bienvenue"
          multiline
          maxLength={2000}
          style={{ minHeight: 80, textAlignVertical: 'top', borderRadius: 0 }}
        />
      </Section>
      <Section title="Adresse personnalisée" footer="Invitation par cette adresse au lieu d'un code ; vide pour la retirer.">
        <TextField
          value={vanity}
          onChangeText={(t) => setVanity(t.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="mon-serveur"
          accessibilityLabel="Adresse personnalisée"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          style={{ borderRadius: 0 }}
        />
      </Section>
      {error ? <T variant="error" style={{ marginBottom: spacing.md }}>{error}</T> : null}
      <Button title="Enregistrer" onPress={save} loading={busy === 'save'} style={{ marginBottom: spacing.xl }} />

      <Section title="Barrière de vérification" footer="Les nouveaux membres doivent accepter ces règles avant d'écrire.">
        <SwitchRow icon="checkmark-circle-outline" title="Vérification à l'arrivée" value={verif} onValueChange={setVerif} />
        {verif ? (
          <TextField
            value={rules}
            onChangeText={setRules}
            placeholder="Règles à accepter"
            accessibilityLabel="Règles à accepter"
            multiline
            maxLength={2000}
            style={{ minHeight: 100, textAlignVertical: 'top', borderRadius: 0 }}
          />
        ) : null}
      </Section>
      <Button
        title="Enregistrer la vérification"
        variant="secondary"
        loading={busy === 'verif'}
        onPress={() => void run('verif', () => serversApi.updateVerification(server.id, verif, rules.trim() || null), 'Vérification enregistrée')}
        style={{ marginBottom: spacing.xl }}
      />

      <Section title="Modèle" footer="Copie salons, catégories et rôles (sans messages ni membres).">
        <TextField value={template} onChangeText={setTemplate} placeholder="Nom du modèle" accessibilityLabel="Nom du modèle" maxLength={100} style={{ borderRadius: 0 }} />
        <SwitchRow title="Modèle public" value={templatePublic} onValueChange={setTemplatePublic} />
      </Section>
      <Button title="Enregistrer comme modèle" variant="secondary" icon="copy-outline" loading={busy === 'template'} onPress={saveTemplate} />
    </ScrollView>
  )
}
