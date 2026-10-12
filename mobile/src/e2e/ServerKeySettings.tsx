// Réglages du serveur > Chiffrement (docs/CHIFFREMENT-E2E.md §11) : clé de
// récupération du serveur, réservée au propriétaire. Création (code affiché une
// fois), nouveau code, récupération du contenu de tous les salons sur l'appareil.
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert, ScrollView, Share, View } from 'react-native'
import { Button, ErrorState, Loading, Row, Section, T, TextField } from '@/components/ui'
import { EXPORT_SHARE_MAX_CHARS } from '@/features/account/rules'
import { useServerDetail } from '@/features/servers/menus'
import { t as tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'
import { useAccountKey } from './accountKey'
import { RecoveryCodeModal } from './E2EGate'
import {
  createServerKey, ensureServerKeySigned, getServerKey, recoverServer, recoveredAsText, regenerateServerRecovery, type RecoveredChannel,
} from './serverKey'

/** Erreur lisible des opérations sur la clé du serveur. */
function keyError(e: unknown): string {
  const m = e instanceof Error ? e.message : ''
  if (m === 'NEED_CODE') return tr('e2e.serverKey.needCode')
  if (m === 'BAD_CODE') return tr('e2e.serverKey.badCode')
  if (m === 'E2E_LOCKED') return tr('e2e.settings.locked')
  return errorMessage(e)
}

/** Partage d'un export (pas de fichier sans expo-file-system : texte, borné comme l'export du compte). */
async function shareExport(title: string, text: string) {
  if (text.length > EXPORT_SHARE_MAX_CHARS) return Alert.alert(tr('settings.privacy.exportTooLarge'), tr('settings.privacy.exportTooLargeBody'))
  await Share.share({ title, message: text }).catch(() => undefined)
}

export function ServerKeySettings({ serverId }: { serverId: string }) {
  const t = useT()
  const detail = useServerDetail(serverId)
  const meId = useAuth((st) => st.user?.id)
  const ready = useAccountKey((st) => st.status === 'ready')
  const owner = !!meId && detail.data?.server.owner_id === meId
  const key = useQuery({ queryKey: ['server-key', serverId], queryFn: () => getServerKey(serverId).then((k) => { void ensureServerKeySigned(serverId, k).catch(() => {}); return k }), enabled: owner })
  const [code, setCode] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [recovered, setRecovered] = useState<RecoveredChannel[] | null>(null)
  const name = detail.data?.server.name ?? ''

  if (detail.isLoading) return <Loading />
  if (detail.error) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />

  const run = async (op: () => Promise<void>) => {
    setBusy(true)
    try {
      await op()
    } catch (e) {
      Alert.alert(t('e2e.serverKey.title'), keyError(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  const create = () => run(async () => {
    setCode(await createServerKey(serverId))
    void key.refetch()
  })
  const regenerate = () =>
    Alert.alert(t('e2e.serverKey.regenerate'), t('e2e.serverKey.regenerateDesc'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('e2e.serverKey.regenerate'), onPress: () => void run(async () => setCode(await regenerateServerRecovery(serverId, input.trim() || undefined))) },
    ])
  const recover = () => run(async () => {
    setRecovered(await recoverServer(serverId, input.trim() || undefined, (done, total) => setProgress(t('e2e.serverKey.progress', { done, total }))))
  })
  const exportText = (list: RecoveredChannel[]) => recoveredAsText(list, t('e2e.serverKey.unreadable'))

  const k = key.data
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }} keyboardShouldPersistTaps="handled">
      <Section title={t('e2e.serverKey.title')} footer={t('e2e.serverKey.desc')}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {!owner ? (
            <T variant="muted">{t('e2e.serverKey.ownerOnly')}</T>
          ) : !ready ? (
            <T variant="muted">{t('e2e.settings.locked')}</T>
          ) : key.isLoading ? (
            <Loading />
          ) : key.error ? (
            <T variant="muted">{errorMessage(key.error)}</T>
          ) : k?.exists ? (
            <T>{t('e2e.serverKey.exists', { fp: (k.fingerprint ?? '').slice(0, 16) })}</T>
          ) : (
            <>
              <T variant="muted">{t('e2e.serverKey.none')}</T>
              <Button title={t('e2e.serverKey.create')} icon="key-outline" loading={busy} disabled={busy} onPress={() => void create()} />
            </>
          )}
        </View>
      </Section>

      {owner && ready && k?.exists ? (
        <>
          <Section footer={t('e2e.serverKey.regenerateDesc')}>
            <Row icon="refresh-outline" title={t('e2e.serverKey.regenerate')} chevron onPress={busy ? undefined : regenerate} />
          </Section>
          <Section title={t('e2e.serverKey.recover')} footer={t('e2e.serverKey.recoverDesc')}>
            <View style={{ padding: spacing.lg, gap: spacing.md }}>
              <TextField
                value={input}
                onChangeText={setInput}
                placeholder={t('e2e.serverKey.codePlaceholder')}
                accessibilityLabel={t('e2e.serverKey.codePlaceholder')}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {progress ? <T variant="muted">{progress}</T> : null}
              <Button title={t('e2e.serverKey.recover')} icon="download-outline" loading={busy} disabled={busy} onPress={() => void recover()} />
            </View>
          </Section>
        </>
      ) : null}

      {recovered ? (
        <Section title={t('e2e.serverKey.recovered', { n: recovered.length })}>
          <Row icon="code-outline" title={t('e2e.serverKey.exportJson')} onPress={() => void shareExport(`${name}.json`, JSON.stringify(recovered, null, 2))} />
          <Row icon="document-text-outline" title={t('e2e.serverKey.exportText')} onPress={() => void shareExport(`${name}.txt`, exportText(recovered))} />
          {/* Lecture salon par salon (et export plus petit qu'un serveur entier). */}
          {recovered.map((ch) => (
            <Row key={ch.channel_id} icon="chatbox-outline" title={`#${ch.name}`} subtitle={String(ch.messages.length)}
              onPress={() => void shareExport(`${ch.name}.txt`, exportText([ch]))} />
          ))}
        </Section>
      ) : null}

      {code ? (
        <RecoveryCodeModal
          code={code}
          onDone={() => setCode(null)}
          texts={{ title: t('e2e.serverKey.codeTitle'), desc: t('e2e.serverKey.codeDesc'), fileHeader: t('e2e.serverKey.fileHeader', { name }) }}
        />
      ) : null}
    </ScrollView>
  )
}
