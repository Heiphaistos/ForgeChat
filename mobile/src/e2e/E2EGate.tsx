// Écrans de la clé de compte E2E (mobile) : code de récupération affiché une
// fois, déverrouillage (mot de passe ou code), nouvelle clé en dernier recours,
// indicateur « Préparation du chiffrement… » pendant PBKDF2 (lent en JS).
// Chiffrement obligatoire : sans clé prête, l'écran bloque l'accès aux conversations.
import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { Button, PasswordField, T, TextField } from '@/components/ui'
import { t as tr, useT, type Key } from '@/i18n'
import { ApiError } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { colors, radius, spacing } from '@/theme'
import { forgetConv, reencryptLegacy } from './conversations'
import { formatRecoveryCode } from './crypto'
import {
  createAccountKey, hasTypedPassword, initAccountKey, resetAccountKey,
  unlockWithPassword, unlockWithRecovery, useAccountKey,
} from './accountKey'

type Tab = 'password' | 'code' | 'reset'

export function errorText(e: unknown, fallback: Key): string {
  if (e instanceof ApiError) return e.message === 'FRESH_LOGIN_REQUIRED' ? tr('e2e.unlock.freshLogin') : e.message
  if (e instanceof Error && e.message === 'NEED_PASSWORD') return tr('e2e.unlock.needPassword')
  return tr(fallback)
}

function Checkbox({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }} style={s.check}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={22} color={value ? colors.primary : colors.textMuted} />
      <Text style={s.checkLabel}>{label}</Text>
    </Pressable>
  )
}

/**
 * Code de récupération : affiché une seule fois, copie/partage, « je l'ai noté ».
 * `texts` : titre, description et en-tête du fichier (code d'un serveur) ; défaut : code du compte.
 */
export function RecoveryCodeModal({ code, onDone, texts }: {
  code: string; onDone: () => void; texts?: { title: string; desc: string; fileHeader: string }
}) {
  const t = useT()
  const [noted, setNoted] = useState(false)
  const shown = formatRecoveryCode(code)
  const fileHeader = texts?.fileHeader ?? tr('e2e.recovery.fileHeader')
  return (
    <Modal visible animationType="slide" onRequestClose={() => noted && onDone()}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page}>
        <T variant="title">{texts?.title ?? t('e2e.recovery.title')}</T>
        <T variant="muted">{texts?.desc ?? t('e2e.recovery.desc')}</T>
        <Text selectable style={s.code}>{shown}</Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button style={{ flex: 1 }} variant="secondary" icon="copy-outline" title={t('e2e.recovery.copy')}
            onPress={() => void Clipboard.setStringAsync(shown).then(() => Alert.alert(tr('e2e.recovery.copied')))} />
          <Button style={{ flex: 1 }} variant="secondary" icon="share-outline" title={t('e2e.recovery.share')}
            onPress={() => void Share.share({ message: `${fileHeader}\n\n${shown}` })} />
        </View>
        <Checkbox value={noted} onChange={setNoted} label={t('e2e.recovery.noted')} />
        <Button title={t('e2e.recovery.done')} disabled={!noted} onPress={onDone} />
      </ScrollView>
    </Modal>
  )
}

/**
 * Création de la clé (compte sans clé, session déjà ouverte) ou déverrouillage
 * (nouvel appareil, données effacées, mot de passe réinitialisé). Bloquant :
 * seule issue autre que la clé, la déconnexion.
 */
function UnlockModal({ userId }: { userId: string }) {
  const t = useT()
  const logout = useAuth((st) => st.logout)
  const mode = useAccountKey((st) => st.mode)
  const busy = useAccountKey((st) => st.status === 'working')
  const [tab, setTab] = useState<Tab>('password')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Mot de passe déjà saisi à la connexion : inutile de le redemander pour ré-envelopper.
  const needPw = mode === 'setup' || tab === 'password' || !hasTypedPassword()

  const submit = async () => {
    setError(null)
    try {
      if (mode === 'setup') await createAccountKey(userId, pw)
      else if (tab === 'password') await unlockWithPassword(userId, pw)
      else if (tab === 'code') await unlockWithRecovery(userId, code, pw || undefined)
      else await resetAccountKey(userId, pw || undefined)
    } catch (e) {
      setError(errorText(e, tab === 'code' ? 'e2e.unlock.badCode' : 'e2e.unlock.wrong'))
    }
  }

  const tabs: [Tab, Key][] = [['password', 'e2e.unlock.tabPassword'], ['code', 'e2e.unlock.tabCode'], ['reset', 'e2e.unlock.tabReset']]
  return (
    <Modal visible animationType="slide" onRequestClose={() => undefined}>
      <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <T variant="title">{t(mode === 'setup' ? 'e2e.setup.title' : 'e2e.unlock.title')}</T>
        <T variant="muted">{t(mode === 'setup' ? 'e2e.setup.desc' : 'e2e.unlock.desc')}</T>
        {mode === 'unlock' ? (
          <View style={s.tabs}>
            {tabs.map(([k, label]) => (
              <Pressable key={k} onPress={() => { setTab(k); setError(null) }} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}
                style={[s.tab, tab === k && { backgroundColor: colors.primary }]}>
                <Text style={[s.tabLabel, tab === k && { color: '#fff' }]}>{t(label)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {mode === 'unlock' && tab === 'code' ? (
          <TextField label={t('e2e.unlock.codeLabel')} value={code} onChangeText={setCode} placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            autoCapitalize="characters" autoCorrect={false} />
        ) : null}
        {mode === 'unlock' && tab === 'reset' ? (
          <>
            <T style={{ color: colors.danger }}>{t('e2e.unlock.resetWarning')}</T>
            <Checkbox value={confirmReset} onChange={setConfirmReset} label={t('e2e.unlock.resetConfirm')} />
          </>
        ) : null}
        {needPw ? (
          <PasswordField label={t('e2e.unlock.password')} value={pw} onChangeText={setPw} autoComplete="current-password" textContentType="password" />
        ) : null}
        {error ? <T variant="error">{error}</T> : null}
        <Button
          title={t(mode === 'setup' ? 'e2e.setup.submit' : tab === 'reset' ? 'e2e.unlock.resetSubmit' : 'e2e.unlock.submit')}
          variant={mode === 'unlock' && tab === 'reset' ? 'danger' : 'primary'}
          loading={busy}
          disabled={busy || (needPw && !pw) || (mode === 'unlock' && ((tab === 'reset' && !confirmReset) || (tab === 'code' && !code)))}
          onPress={() => void submit()}
        />
        {busy ? <T variant="muted" style={{ textAlign: 'center' }}>{t('e2e.preparing')}</T> : null}
        <Button variant="ghost" title={t('e2e.unlock.logout')} onPress={() => void logout()} disabled={busy} />
      </ScrollView>
    </Modal>
  )
}

/** Monté dans la pile de l'appli connectée. */
export default function E2EGate() {
  const t = useT()
  const userId = useAuth((st) => st.user?.id)
  const status = useAccountKey((st) => st.status)
  const recovery = useAccountKey((st) => st.recoveryToShow)
  const prompt = useAccountKey((st) => st.prompt)

  useEffect(() => {
    // Erreur réseau : on réessaiera à la prochaine ouverture, l'appli reste utilisable.
    if (userId) initAccountKey(userId).catch(() => {})
    else forgetConv()
  }, [userId])

  // Clé prête : rechiffrement en arrière-plan de mes anciens messages en clair (par lots).
  useEffect(() => {
    if (status === 'ready') void reencryptLegacy()
  }, [status])

  if (!userId) return null
  if (recovery) return <RecoveryCodeModal code={recovery} onDone={() => useAccountKey.setState({ recoveryToShow: null })} />
  // Reste ouvert pendant le calcul (statut « working ») : l'erreur éventuelle s'y affiche.
  if (prompt && status !== 'ready') return <UnlockModal userId={userId} />
  if (status === 'working') return <Preparing label={t('e2e.preparing')} />
  return null
}

function Preparing({ label }: { label: string }) {
  return (
    <View pointerEvents="none" style={s.banner}>
      <ActivityIndicator color="#fff" />
      <Text style={{ color: '#fff' }}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  page: { padding: spacing.xl, paddingTop: spacing.xxl * 2, gap: spacing.lg },
  code: { fontFamily: 'monospace', fontSize: 20, letterSpacing: 1, color: colors.text, textAlign: 'center', backgroundColor: colors.bgElevated, padding: spacing.lg, borderRadius: radius.md },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkLabel: { color: colors.text, flex: 1 },
  tabs: { flexDirection: 'row', gap: spacing.xs },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.bgElevated, alignItems: 'center' },
  tabLabel: { color: colors.textMuted, fontWeight: '600' },
  banner: { position: 'absolute', top: spacing.xxl * 2, alignSelf: 'center', flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.8)', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.full },
})
