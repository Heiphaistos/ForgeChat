// Écrans de la clé de compte E2E : code de récupération affiché une fois,
// déverrouillage (mot de passe ou code), nouvelle clé en dernier recours.
import { useEffect, useState } from 'react'
import { Copy, Download, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import { useT } from '../i18n'
import { formatRecoveryCode } from './crypto'
import {
  createAccountKey, hasTypedPassword, initAccountKey, resetAccountKey,
  unlockWithPassword, unlockWithRecovery, useAccountKey,
} from './accountKey'
import { answerKeyRequest, forgetConv, reencryptLegacy } from './conversations'

const inputCls = 'w-full px-3 py-2 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent'
const btnCls = 'w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50'

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto">
      <div role="dialog" aria-modal="true" className="bg-fc-channel p-6 rounded-lg shadow-xl w-full max-w-md">{children}</div>
    </div>
  )
}

/** Textes d'un code de récupération autre que celui du compte (clé du serveur). */
export interface RecoveryTexts { title: string; desc: string; fileHeader: string; fileName: string }

/** Code de récupération : affiché une seule fois, copie/téléchargement, « je l'ai noté ». */
export function RecoveryCodeModal({ code, onDone, texts }: { code: string; onDone: () => void; texts?: RecoveryTexts }) {
  const t = useT()
  const [noted, setNoted] = useState(false)
  const shown = formatRecoveryCode(code)
  const copy = () => navigator.clipboard.writeText(shown).then(() => toast.success(t('e2e.recovery.copied')), () => {})
  const download = () => {
    const header = texts?.fileHeader ?? t('e2e.recovery.fileHeader')
    const url = URL.createObjectURL(new Blob([`${header}\n\n${shown}\n`], { type: 'text/plain' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: texts?.fileName ?? 'forgechat-code-de-recuperation.txt' })
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Overlay>
      <h2 className="text-xl font-bold text-white mb-2">{texts?.title ?? t('e2e.recovery.title')}</h2>
      <p className="text-sm text-fc-muted mb-4">{texts?.desc ?? t('e2e.recovery.desc')}</p>
      <div className="font-mono text-lg text-center text-white bg-fc-input rounded py-3 mb-3 select-all tracking-wider">{shown}</div>
      <div className="flex gap-2 mb-4">
        <button type="button" onClick={copy} className="flex-1 flex items-center justify-center gap-2 py-2 bg-fc-hover text-white rounded text-sm">
          <Copy size={14} /> {t('e2e.recovery.copy')}
        </button>
        <button type="button" onClick={download} className="flex-1 flex items-center justify-center gap-2 py-2 bg-fc-hover text-white rounded text-sm">
          <Download size={14} /> {t('e2e.recovery.download')}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-white mb-4 cursor-pointer">
        <input type="checkbox" checked={noted} onChange={e => setNoted(e.target.checked)} />
        {t('e2e.recovery.noted')}
      </label>
      <button type="button" disabled={!noted} onClick={onDone} className={btnCls}>{t('e2e.recovery.done')}</button>
    </Overlay>
  )
}

type Tab = 'password' | 'code' | 'reset'

function errorText(e: any, t: ReturnType<typeof useT>, tab: Tab): string {
  const msg = e?.response?.data?.error
  if (msg === 'FRESH_LOGIN_REQUIRED') return t('e2e.unlock.freshLogin')
  if (msg) return msg
  if (e?.message === 'NEED_PASSWORD') return t('e2e.unlock.needPassword')
  return t(tab === 'code' ? 'e2e.unlock.badCode' : 'e2e.unlock.wrong')
}

/** « Déverrouiller tes messages » : nouvel appareil, données effacées ou mot de passe réinitialisé. */
function UnlockScreen({ userId, onLater }: { userId: string; onLater: () => void }) {
  const t = useT()
  const mode = useAccountKey(s => s.mode)
  const [tab, setTab] = useState<Tab>('password')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [busy, setBusy] = useState(false)
  // Mot de passe déjà saisi à la connexion : inutile de le redemander pour ré-envelopper.
  const needPw = tab === 'password' || !hasTypedPassword()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'setup') await createAccountKey(userId, pw)
      else if (tab === 'password') await unlockWithPassword(userId, pw)
      else if (tab === 'code') await unlockWithRecovery(userId, code, pw || undefined)
      else await resetAccountKey(userId, pw || undefined)
    } catch (err) {
      toast.error(errorText(err, t, tab))
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (k: Tab, label: string) => (
    <button type="button" onClick={() => setTab(k)}
      className={`flex-1 py-1.5 text-xs rounded ${tab === k ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted'}`}>{label}</button>
  )

  return (
    <Overlay>
      <div className="flex items-center gap-2 mb-2">
        <Lock size={18} className="text-fc-accent" />
        <h2 className="text-xl font-bold text-white">{t(mode === 'setup' ? 'e2e.setup.title' : 'e2e.unlock.title')}</h2>
      </div>
      <p className="text-sm text-fc-muted mb-4">{t(mode === 'setup' ? 'e2e.setup.desc' : 'e2e.unlock.desc')}</p>
      {mode === 'unlock' && (
        <div className="flex gap-1 mb-4">
          {tabBtn('password', t('e2e.unlock.tabPassword'))}
          {tabBtn('code', t('e2e.unlock.tabCode'))}
          {tabBtn('reset', t('e2e.unlock.tabReset'))}
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        {mode === 'unlock' && tab === 'code' && (
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoFocus
            autoComplete="off" spellCheck={false} aria-label={t('e2e.unlock.tabCode')} className={`${inputCls} font-mono`} />
        )}
        {mode === 'unlock' && tab === 'reset' && (
          <>
            <p className="text-sm text-red-300">{t('e2e.unlock.resetWarning')}</p>
            <label className="flex items-start gap-2 text-sm text-white cursor-pointer">
              <input type="checkbox" className="mt-1" checked={confirmReset} onChange={e => setConfirmReset(e.target.checked)} />
              {t('e2e.unlock.resetConfirm')}
            </label>
          </>
        )}
        {(mode === 'setup' || needPw) && (
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoComplete="current-password"
            placeholder={t('e2e.unlock.passwordPlaceholder')} aria-label={t('auth.password')} className={inputCls}
            autoFocus={tab !== 'code'} />
        )}
        <button type="submit" className={btnCls}
          disabled={busy || (tab === 'reset' && mode === 'unlock' && !confirmReset) || (tab === 'code' && mode === 'unlock' && !code)}>
          {busy ? t('e2e.preparing') : t(mode === 'setup' ? 'e2e.setup.submit' : tab === 'reset' ? 'e2e.unlock.resetSubmit' : 'e2e.unlock.submit')}
        </button>
      </form>
      <button type="button" onClick={onLater} className="w-full mt-3 text-xs text-fc-muted hover:text-white">{t('e2e.unlock.later')}</button>
    </Overlay>
  )
}

/** Monté à la racine de l'appli connectée. */
const LATER_KEY = 'fc_e2e_later'

export default function E2EGate() {
  const userId = useAuth(s => s.user?.id)
  const status = useAccountKey(s => s.status)
  const recovery = useAccountKey(s => s.recoveryToShow)
  // « Plus tard » vaut pour la session du navigateur (pas de rappel à chaque page).
  const [later, setLater] = useState(() => {
    try { return sessionStorage.getItem(LATER_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    if (!userId) return
    // Erreur réseau : on réessaiera au prochain chargement, l'appli reste utilisable.
    initAccountKey(userId).catch(() => {})
  }, [userId])

  // Conversations chiffrées : clés demandées par d'autres membres, clés reçues,
  // et rechiffrement de mes anciens messages dès que ma clé est prête.
  const on = useWs(s => s.on)
  useEffect(() => {
    if (status !== 'ready') return
    void reencryptLegacy()
    const offReq = on('KEY_REQUEST', (d: any) => { void answerKeyRequest(d) })
    const offKeys = on('E2E_KEYS', (d: any) => forgetConv(d.conv_kind, d.conv_id))
    // Clé de récupération d'un serveur créée ou changée : les prochaines époques doivent l'inclure.
    const offServerKey = on('SERVER_KEY', () => forgetConv())
    return () => { offReq(); offKeys(); offServerKey() }
  }, [status, on])
  useEffect(() => { if (!userId) forgetConv() }, [userId])

  if (!userId) return null
  if (recovery) return <RecoveryCodeModal code={recovery} onDone={() => useAccountKey.setState({ recoveryToShow: null })} />
  if (status === 'locked' && !later) {
    return <UnlockScreen userId={userId} onLater={() => {
      setLater(true)
      try { sessionStorage.setItem(LATER_KEY, '1') } catch { /* session seule */ }
    }} />
  }
  return null
}
