import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, Section, T, TextField } from '@/components/ui'
import { createServer } from '@/features/servers/createFromTemplate'
import {
  channelIcon,
  parseRemoteTemplates,
  serverNameError,
  templatePreview,
  type ServerTemplate,
} from '@/features/servers/templates'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useUi } from '@/stores/ui'
import { colors, font, radius, spacing } from '@/theme'

type Step = 'choice' | 'templates' | 'name'

/** Création de serveur : depuis zéro, depuis un modèle public ou depuis un de mes modèles
 *  (même parcours et mêmes modèles que le client web, voir features/servers/templates.ts). */
export default function CreateServerScreen() {
  const t = useT()
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
  const publicTemplates = [...(remote.data?.builtin ?? []), ...(remote.data?.public ?? [])]
  const mine = remote.data?.mine ?? []

  const pick = (tpl: ServerTemplate | null) => {
    setTemplate(tpl)
    setName(tpl?.name ?? '')
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

  const title =
    step === 'choice'
      ? t('server.create.title')
      : step === 'templates'
        ? t('server.create.pickTemplate')
        : template
          ? t('server.create.templateTitle', { name: template.name })
          : t('server.create.title')

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      {step === 'choice' ? (
        <>
          <T variant="muted">{t('server.create.intro')}</T>
          <Choice title={t('server.create.scratch')} subtitle={t('server.create.scratchSub')} icon="add-circle-outline" onPress={() => pick(null)} />
          <Choice title={t('server.create.fromTemplate')} subtitle={t('server.create.fromTemplateSub')} icon="albums-outline" onPress={() => setStep('templates')} />
        </>
      ) : null}

      {step === 'templates' ? (
        <>
          <BackLink label={t('common.back')} onPress={() => setStep('choice')} />
          <Section title={t('server.create.publicTemplates')}>
            {publicTemplates.map((tpl) => (
              <TemplateRow key={`${tpl.source}:${tpl.id}`} tpl={tpl} onPress={() => pick(tpl)} />
            ))}
          </Section>
          {remote.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
          {remote.isError ? <T variant="muted">{t('server.create.remoteError')}</T> : null}
          {mine.length ? (
            <Section title={t('server.create.myTemplates')}>
              {mine.map((tpl) => (
                <TemplateRow key={`mine:${tpl.id}`} tpl={tpl} onPress={() => pick(tpl)} />
              ))}
            </Section>
          ) : null}
        </>
      ) : null}

      {step === 'name' ? (
        <>
          <BackLink label={template ? t('server.create.changeTemplate') : t('common.back')} onPress={() => setStep(template ? 'templates' : 'choice')} />
          {template ? <TemplatePreview tpl={template} /> : <T variant="muted">{t('server.create.blurb')}</T>}
          <TextField label={t('server.create.name')} value={name} onChangeText={setName} maxLength={100} autoFocus error={error} />
          {template?.source === 'builtin' || !template ? (
            <TextField label={t('server.create.description')} value={description} onChangeText={setDescription} maxLength={500} multiline />
          ) : null}
          <Button title={t('server.create.submit')} onPress={submit} loading={loading} />
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

function TemplateRow({ tpl, onPress }: { tpl: ServerTemplate; onPress: () => void }) {
  const t = useT()
  const n = tpl.data.channels.length
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('server.create.templateLabel', { name: tpl.name, n, description: tpl.description })}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bgAlt }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.cardTitle}>{tpl.name}</Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          {tpl.description}
        </Text>
        <Text style={styles.count}>{t(n > 1 ? 'server.create.channelsMany' : 'server.create.channelsOne', { n })}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  )
}

function TemplatePreview({ tpl }: { tpl: ServerTemplate }) {
  const t = useT()
  const p = templatePreview(tpl.data)
  return (
    <View style={styles.preview} accessibilityLabel={t('server.create.previewLabel', { channels: p.channelCount, categories: p.categoryCount, roles: p.roles.length })}>
      <Text style={styles.cardSub}>
        {t(p.channelCount > 1 ? 'server.create.previewMany' : 'server.create.previewOne', { n: p.channelCount })}
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
          <Text style={styles.category}>{t('server.create.roles')}</Text>
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
