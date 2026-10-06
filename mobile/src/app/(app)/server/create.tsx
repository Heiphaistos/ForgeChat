import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, Section, T, TextField } from '@/components/ui'
import { createServer } from '@/features/servers/createFromTemplate'
import {
  builtinTemplates,
  channelIcon,
  parseRemoteTemplates,
  serverNameError,
  templatePreview,
  type ServerTemplate,
} from '@/features/servers/templates'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useUi } from '@/stores/ui'
import { colors, font, radius, spacing } from '@/theme'

type Step = 'choice' | 'templates' | 'name'

/** Création de serveur : depuis zéro, depuis un modèle public ou depuis un de mes modèles
 *  (même parcours et mêmes modèles que le client web, voir features/servers/templates.ts). */
export default function CreateServerScreen() {
  const [step, setStep] = useState<Step>('choice')
  const [template, setTemplate] = useState<ServerTemplate | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remote = useQuery({
    queryKey: ['server-templates'],
    queryFn: async () => parseRemoteTemplates(await serversApi.templates()),
    enabled: step !== 'choice',
    staleTime: 60_000,
  })
  const publicTemplates = [...builtinTemplates, ...(remote.data?.public ?? [])]
  const mine = remote.data?.mine ?? []

  const pick = (t: ServerTemplate | null) => {
    setTemplate(t)
    setName(t?.name ?? '')
    setError(null)
    setStep('name')
  }

  const submit = async () => {
    const n = name.trim()
    const err = serverNameError(n)
    if (err) {
      setError(err)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const server = await createServer(n, template, template?.source === 'builtin' || !template ? description : undefined)
      await queryClient.invalidateQueries({ queryKey: qk.servers })
      useUi.getState().selectServer(server.id)
      router.dismissTo('/')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const title = step === 'choice' ? 'Créer un serveur' : step === 'templates' ? 'Choisir un modèle' : template ? `Modèle : ${template.name}` : 'Créer un serveur'

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      {step === 'choice' ? (
        <>
          <T variant="muted">Commence depuis zéro ou utilise un modèle.</T>
          <Choice title="Créer depuis zéro" subtitle="Serveur vide avec un salon général" icon="add-circle-outline" onPress={() => pick(null)} />
          <Choice title="Depuis un modèle" subtitle="Gaming, Communauté, Étude, Team et plus…" icon="albums-outline" onPress={() => setStep('templates')} />
        </>
      ) : null}

      {step === 'templates' ? (
        <>
          <BackLink label="Retour" onPress={() => setStep('choice')} />
          <Section title="Modèles publics">
            {publicTemplates.map((t) => (
              <TemplateRow key={`${t.source}:${t.id}`} t={t} onPress={() => pick(t)} />
            ))}
          </Section>
          {remote.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {remote.isError ? <T variant="muted">Modèles partagés indisponibles pour le moment.</T> : null}
          {mine.length ? (
            <Section title="Mes modèles">
              {mine.map((t) => (
                <TemplateRow key={`mine:${t.id}`} t={t} onPress={() => pick(t)} />
              ))}
            </Section>
          ) : null}
        </>
      ) : null}

      {step === 'name' ? (
        <>
          <BackLink label={template ? 'Changer de modèle' : 'Retour'} onPress={() => setStep(template ? 'templates' : 'choice')} />
          {template ? <TemplatePreview t={template} /> : <T variant="muted">Ton serveur, c’est l’endroit où tu retrouves tes amis. Crée-le puis invite-les.</T>}
          <TextField label="Nom du serveur" value={name} onChangeText={setName} maxLength={100} autoFocus error={error} />
          {template?.source === 'builtin' || !template ? (
            <TextField label="Description (optionnel)" value={description} onChangeText={setDescription} maxLength={500} multiline />
          ) : null}
          <Button title="Créer le serveur" onPress={submit} loading={loading} />
        </>
      ) : null}
    </ScrollView>
  )
}

function Choice({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={28} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  )
}

function TemplateRow({ t, onPress }: { t: ServerTemplate; onPress: () => void }) {
  const n = t.data.channels.length
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Modèle ${t.name}, ${n} salons. ${t.description}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgAlt }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle}>{t.name}</Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          {t.description}
        </Text>
        <Text style={styles.count}>{n} salon{n > 1 ? 's' : ''}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  )
}

function TemplatePreview({ t }: { t: ServerTemplate }) {
  const p = templatePreview(t.data)
  return (
    <View style={styles.preview} accessibilityLabel={`Aperçu : ${p.channelCount} salons, ${p.categoryCount} catégories, ${p.roles.length} rôles`}>
      <Text style={styles.cardSub}>
        {p.channelCount} salon{p.channelCount > 1 ? 's' : ''} seront créés automatiquement.
      </Text>
      {p.sections.map((s, i) => (
        <View key={i} style={{ gap: 4 }}>
          {s.title ? <Text style={styles.category}>{s.title.toUpperCase()}</Text> : null}
          {s.channels.map((c, j) => (
            <Text key={j} style={styles.channel}>
              {channelIcon(c.type)} {c.name}
            </Text>
          ))}
        </View>
      ))}
      {p.roles.length ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.category}>RÔLES</Text>
          <View style={styles.chips}>
            {p.roles.map((r, i) => (
              <View key={i} style={styles.chip}>
                <View style={[styles.dot, { backgroundColor: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : colors.textMuted }]} />
                <Text style={styles.chipText}>{r.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name="chevron-back" size={16} color={colors.primary} />
      <Text style={{ color: colors.primary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  cardTitle: { color: colors.text, fontSize: font.md, fontWeight: '700' },
  cardSub: { color: colors.textMuted, fontSize: font.sm },
  count: { color: colors.textFaint, fontSize: font.xs },
  preview: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  category: { color: colors.textMuted, fontSize: font.xs, fontWeight: '700' },
  channel: { color: colors.textSecondary, fontSize: font.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bgDeep, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chipText: { color: colors.text, fontSize: font.sm },
})
