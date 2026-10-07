// Réglages > Sécurité : clé de compte E2E ; profils : code de sécurité à comparer.
import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { Button, PasswordField, Row, Section, T } from '@/components/ui'
import { useT } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'
import { regenerateRecoveryCode, safetyCodeWith, useAccountKey } from './accountKey'
import { errorText, RecoveryCodeModal } from './E2EGate'

export function E2EKeySection() {
  const t = useT()
  const userId = useAuth((st) => st.user?.id)
  const ready = useAccountKey((st) => st.status === 'ready')
  const busy = useAccountKey((st) => st.status === 'working')
  const [asking, setAsking] = useState(false)
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)

  const regenerate = async () => {
    if (!userId) return
    setError(null)
    try {
      setCode(await regenerateRecoveryCode(userId, pw))
      setAsking(false)
      setPw('')
    } catch (e) {
      setError(errorText(e, 'e2e.unlock.wrong'))
    }
  }

  return (
    <Section title={t('e2e.settings.title')} footer={t(ready ? 'e2e.settings.ready' : 'e2e.settings.locked')}>
      {ready && !asking ? <Row icon="key-outline" title={t('e2e.settings.regenerate')} chevron onPress={() => setAsking(true)} /> : null}
      {asking ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <T variant="muted">{t('e2e.settings.regenerateDesc')}</T>
          <PasswordField value={pw} onChangeText={setPw} autoComplete="current-password" textContentType="password" error={error}
            accessibilityLabel={t('e2e.unlock.password')} placeholder={t('e2e.unlock.password')} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button style={{ flex: 1 }} variant="secondary" title={t('common.cancel')} onPress={() => { setAsking(false); setPw(''); setError(null) }} />
            <Button style={{ flex: 1 }} title={t('e2e.settings.regenerate')} loading={busy} disabled={busy || !pw} onPress={() => void regenerate()} />
          </View>
        </View>
      ) : null}
      {code ? <RecoveryCodeModal code={code} onDone={() => setCode(null)} /> : null}
    </Section>
  )
}

/** Code de sécurité partagé avec `userId` : identique sur les deux écrans si personne ne s'interpose. */
export function SafetyCode({ userId }: { userId: string }) {
  const t = useT()
  const ready = useAccountKey((st) => st.status === 'ready')
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (ready) void safetyCodeWith(userId).then((c) => { if (alive) setCode(c) })
    return () => { alive = false }
  }, [userId, ready])
  const groups = code?.match(/.{5}/g) ?? []
  return (
    <Section title={t('e2e.safety.title')} footer={code ? t('e2e.safety.desc') : undefined}>
      <View style={{ padding: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }} accessible accessibilityLabel={code ?? undefined}>
        {code
          ? groups.map((g, i) => <Text key={i} style={{ fontFamily: 'monospace', fontSize: 16, color: colors.text, width: '20%' }}>{g}</Text>)
          : <T variant="muted">{t(ready ? 'e2e.safety.none' : 'e2e.settings.locked')}</T>}
      </View>
    </Section>
  )
}
