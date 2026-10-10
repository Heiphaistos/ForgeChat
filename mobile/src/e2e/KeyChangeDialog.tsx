// Boîte de dialogue BLOQUANTE « la clé de X a changé » (épinglage TOFU, keyPins.ts) :
// tant qu'elle n'est pas acceptée, rien n'est chiffré vers cette clé.
import { useEffect, useState } from 'react'
import { Modal, ScrollView, Text, View } from 'react-native'
import { Button, T } from '@/components/ui'
import { useT } from '@/i18n'
import { colors, spacing } from '@/theme'
import { useAccountKey } from './accountKey'
import * as c from './crypto'
import { acceptKey, refuseKey, useKeyAlerts } from './keyPins'

const groups = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'g')) ?? []

export default function KeyChangeDialog() {
  const t = useT()
  const alert = useKeyAlerts((s) => s.alerts[0])
  const myPub = useAccountKey((s) => s.pub)
  // Code calculé pour l'empreinte `fp` (une autre alerte peut lui succéder).
  const [safety, setSafety] = useState<{ fp: string; code: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (alert?.kind === 'user' && myPub) {
      c.safetyCode(c.b64uDecode(myPub), c.b64uDecode(alert.pub)).then((v) => { if (alive) setSafety({ fp: alert.fp, code: v }) }, () => undefined)
    }
    return () => { alive = false }
  }, [alert, myPub])

  if (!alert) return null
  const code = safety?.fp === alert.fp ? safety.code : null
  const red = alert.verified || alert.kind === 'server'
  const mono = { fontFamily: 'monospace', fontSize: 15, color: colors.text } as const
  return (
    // Bouton retour = « pas maintenant » (la clé reste exclue du chiffrement).
    <Modal visible transparent animationType="fade" onRequestClose={() => refuseKey(alert)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: spacing.lg }}>
        <ScrollView
          style={{ flexGrow: 0, backgroundColor: colors.bgElevated, borderRadius: 12, borderWidth: 1, borderColor: red ? colors.danger : colors.warning }}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          accessibilityRole="alert"
        >
          <T variant="subtitle" style={{ color: red ? colors.danger : colors.warning }}>
            {t(alert.kind === 'server' ? 'e2e.pin.titleServer' : 'e2e.pin.title', { name: alert.name })}
          </T>
          {alert.verified ? <T style={{ color: colors.danger }}>{t('e2e.pin.verifiedWarn')}</T> : null}
          <T variant="muted">{t(alert.kind === 'server' ? 'e2e.pin.descServer' : 'e2e.pin.desc')}</T>
          {alert.kind === 'user' && code ? (
            <View>
              <T variant="label">{t('e2e.safety.title')}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm }} accessible accessibilityLabel={code}>
                {groups(code, 5).map((g, i) => <Text key={i} style={[mono, { width: '20%' }]}>{g}</Text>)}
              </View>
            </View>
          ) : null}
          {alert.kind === 'server' ? (
            <View>
              <T variant="label">{t('e2e.pin.fingerprint')}</T>
              <Text style={[mono, { fontSize: 13 }]} selectable>{groups(alert.fp, 4).join(' ')}</Text>
            </View>
          ) : null}
          <Button variant="secondary" title={t('e2e.pin.refuse')} onPress={() => refuseKey(alert)} />
          <Button
            variant={red ? 'danger' : 'primary'}
            title={t('e2e.pin.accept')}
            loading={busy}
            disabled={busy}
            onPress={() => { setBusy(true); void acceptKey(alert).finally(() => setBusy(false)) }}
          />
        </ScrollView>
      </View>
    </Modal>
  )
}
