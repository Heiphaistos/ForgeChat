// Réglages > Sécurité : clé de compte E2E ; profils : code de sécurité à comparer.
import { useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { Button, PasswordField, Row, Section, T } from '@/components/ui'
import { useT } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { colors, spacing } from '@/theme'
import { http, path } from '@/lib/http'
import { regenerateRecoveryCode, useAccountKey } from './accountKey'
import * as c from './crypto'
import { fpOf, markVerified, pinOf, trustedMembers, useKeyAlerts } from './keyPins'
import { errorText, RecoveryCodeModal } from './E2EGate'
import { SafetyQrImage, SafetyQrScanner } from './SafetyQrView'
import { contactKeyLogged, type KtEntry } from './keyTransparency'
import type { SafetyScan } from './safetyQr'

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
      setPw('')
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

interface Safety { code: string; pub: string; changed: boolean; verified: boolean; logged: boolean | null }

/** Code de sécurité avec la clé servie pour `userId`, comparée à l'empreinte épinglée ; null si l'un n'a pas de clé. */
async function safetyWith(userId: string, mine: string): Promise<Safety | null> {
  try {
    const data = await http.get<{ public: string; kt_seq?: number | null }>(path`/users/${userId}/keys/public`)
    // Journal de transparence (amélioration n° 10) : la clé servie doit y être inscrite.
    let logged: boolean | null = false // pas de `kt_seq` : aucune trace au journal
    if (typeof data.kt_seq === 'number') {
      const entry = await http.get<KtEntry>(`/keys/log/${data.kt_seq}`).catch(() => null)
      logged = await contactKeyLogged(userId, data.public, entry)
    }
    // Première vue : épinglée ; clé changée : boîte de dialogue bloquante.
    const trusted = (await trustedMembers([{ user_id: userId, public: data.public }])).length > 0
    const pin = await pinOf(userId)
    const fp = await fpOf(data.public)
    return {
      code: await c.safetyCode(c.b64uDecode(mine), c.b64uDecode(data.public)),
      pub: data.public, changed: !trusted, verified: trusted && pin?.fp === fp && !!pin.verified, logged,
    }
  } catch {
    return null
  }
}

/** Code de sécurité partagé avec `userId` : identique sur les deux écrans si personne ne s'interpose. */
export function SafetyCode({ userId }: { userId: string }) {
  const t = useT()
  const ready = useAccountKey((st) => st.status === 'ready')
  const mine = useAccountKey((st) => st.pub)
  const [info, setInfo] = useState<Safety | null>(null)
  const [tick, setTick] = useState(0)
  // Nouvelle clé acceptée ou refusée dans la boîte de dialogue : on relit.
  const alerts = useKeyAlerts((s) => s.alerts.length)
  useEffect(() => {
    let alive = true
    if (ready && mine) void safetyWith(userId, mine).then((v) => { if (alive) setInfo(v) })
    return () => { alive = false }
  }, [userId, ready, mine, tick, alerts])
  const code = info?.code ?? null
  const groups = code?.match(/.{5}/g) ?? []
  // Scan en personne (amélioration n° 11) : seule une égalité stricte marque la clé vérifiée.
  const onScan = (r: SafetyScan) => {
    if (r === 'match' && info) {
      void markVerified(userId, info.pub).then((ok) => { if (ok) setTick((n) => n + 1) })
      Alert.alert(t('guard.qr.match'))
    } else {
      Alert.alert(t('e2e.safety.title'), t(r === 'mismatch' ? 'guard.qr.mismatch' : 'guard.qr.invalid'))
    }
  }
  const pad = { paddingHorizontal: spacing.lg, paddingBottom: spacing.md }
  return (
    <Section title={t('e2e.safety.title')} footer={code ? t('e2e.safety.desc') : undefined}>
      <View style={{ padding: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }} accessible accessibilityLabel={code ?? undefined}>
        {code
          ? groups.map((g, i) => <Text key={i} style={{ fontFamily: 'monospace', fontSize: 16, color: colors.text, width: '20%' }}>{g}</Text>)
          : <T variant="muted">{t(ready ? 'e2e.safety.none' : 'e2e.settings.locked')}</T>}
      </View>
      {code ? (
        <View style={[pad, { alignItems: 'center', gap: spacing.sm }]}>
          <SafetyQrImage code={code} />
          <T variant="muted">{t('guard.qr.hint')}</T>
          {info && !info.changed ? <SafetyQrScanner code={code} onResult={onScan} /> : null}
        </View>
      ) : null}
      {info?.logged === true ? <T variant="muted" style={pad}>{t('guard.kt.logged')}</T> : null}
      {info?.logged === false ? <T style={[{ color: colors.danger }, pad]}>{t('guard.kt.notLogged')}</T> : null}
      {info?.changed ? <T style={[{ color: colors.danger }, pad]}>{t('e2e.safety.changed')}</T> : null}
      {info?.verified ? <T style={[{ color: colors.success }, pad]}>{t('e2e.safety.verified')}</T> : null}
      {info && !info.changed && !info.verified ? (
        <View style={pad}>
          <Button variant="secondary" title={t('e2e.safety.verify')}
            onPress={() => void markVerified(userId, info.pub).then((ok) => { if (ok) setTick((n) => n + 1) })} />
        </View>
      ) : null}
    </Section>
  )
}
