// Réglages « IA sur l'appareil » : fonctions, langue cible, modèles téléchargés.
import { Stack } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, Text } from 'react-native'
import { Row, Section, SwitchRow } from '@/components/ui'
import { AI_LANGS, useAiSettings } from '@/features/ai/actions'
import { ALL_PACKS, aiCall, downloadPacks, type AiReply, type PackId } from '@/features/ai/bridge'
import { useT, type Key } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { colors, font, spacing } from '@/theme'

export default function AiSettingsScreen() {
  const t = useT()
  const s = useAiSettings()
  // Interroger le moteur démarre la WebView cachée (features/ai/AiEngineHost).
  const q = useQuery({ queryKey: ['ai-status'], queryFn: () => aiCall({ op: 'status' }), staleTime: 0 })
  const status: AiReply | undefined = q.data
  const [busy, setBusy] = useState(false)
  const refresh = () => void q.refetch()

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    try {
      if (!(await fn())) Alert.alert(t('ai.title'), t('ai.download.failed'))
    } finally {
      setBusy(false)
      refresh()
    }
  }
  const have = new Set(status?.installed ?? [])
  const sizeOf = (ids: PackId[]) => ids.filter((i) => !have.has(i)).reduce((n, i) => n + (status?.sizes?.[i] ?? 0), 0)
  const remove = (ids: PackId[]) => run(async () => !!(await aiCall({ op: 'remove', packs: ids })).ok)

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: t('ai.title') }} />
      <Text style={{ color: colors.textMuted, fontSize: font.sm, marginBottom: spacing.lg }}>{t('ai.intro')}</Text>
      <Section footer={t('ai.captions.android')}>
        <SwitchRow title={t('ai.set.translate')} value={s.translate} onValueChange={(v) => s.set({ translate: v })} />
        <SwitchRow title={t('ai.set.transcribe')} value={s.transcribe} onValueChange={(v) => s.set({ transcribe: v })} />
        <SwitchRow title={t('ai.set.precise')} subtitle={t('ai.set.preciseHint')} value={s.precise} onValueChange={(v) => s.set({ precise: v })} />
        <SwitchRow title={t('ai.set.summary')} subtitle={t('ai.set.summaryHint')} value={s.summary} onValueChange={(v) => s.set({ summary: v })} />
      </Section>
      <Section title={t('ai.set.target')}>
        <Row title={t('ai.set.targetAuto')} selected={s.target === null} onPress={() => s.set({ target: null })}
          right={s.target === null ? <Text style={{ color: colors.primary }}>✓</Text> : null} />
        {AI_LANGS.map((l) => (
          <Row key={l} title={t(`ai.lang.${l}` as Key)} selected={s.target === l} onPress={() => s.set({ target: l })}
            right={s.target === l ? <Text style={{ color: colors.primary }}>✓</Text> : null} />
        ))}
      </Section>
      <Section title={t('ai.set.models')} footer={status?.ok ? `${t('ai.set.used', { size: formatBytes(status.used ?? 0) })}\n${t('ai.engineHint')}` : t('ai.engineHint')}>
        {!status ? <ActivityIndicator color={colors.primary} style={{ padding: spacing.md }} /> : null}
        {status?.ok === false ? <Row title={t('ai.download.failed')} /> : null}
        {status?.ok
          ? ALL_PACKS.map((id) => {
              const needs: PackId[] = id === 'runtime' ? [id] : ['runtime', id]
              return have.has(id) ? (
                <Row key={id} title={t(`ai.pack.${id}` as Key)} subtitle={t('ai.set.installed')} danger={false}
                  onPress={busy ? undefined : () => void remove([id])} right={<Text style={{ color: colors.danger }}>{t('ai.set.delete')}</Text>} />
              ) : (
                <Row key={id} title={t(`ai.pack.${id}` as Key)} subtitle={t('ai.set.download', { size: formatBytes(sizeOf(needs)) })}
                  onPress={busy ? undefined : () => void run(() => downloadPacks(needs))} />
              )
            })
          : null}
        {status?.ok && have.size ? (
          <Row title={t('ai.set.deleteAll')} danger onPress={busy ? undefined : () => void remove(ALL_PACKS)} />
        ) : null}
      </Section>
    </ScrollView>
  )
}
