// Réglages > Sécurité : clé de compte E2E ; profils : code de sécurité à comparer.
import { useEffect, useState } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../store/auth'
import { useT } from '../i18n'
import { regenerateRecoveryCode, safetyCodeWith, useAccountKey } from './accountKey'
import { RecoveryCodeModal } from './E2EGate'

/** 60 chiffres en 12 groupes de 5, comme Signal. */
const groups = (code: string) => code.match(/.{5}/g) ?? []

export function E2EKeySection() {
  const t = useT()
  const userId = useAuth(s => s.user?.id)
  const ready = useAccountKey(s => s.status === 'ready')
  const [asking, setAsking] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return
    setBusy(true)
    try {
      setCode(await regenerateRecoveryCode(userId, pw))
      setAsking(false)
      setPw('')
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? t('e2e.unlock.wrong'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-fc-accent" />
        <h3 className="text-sm font-semibold text-white">{t('e2e.settings.title')}</h3>
      </div>
      <p className="text-xs text-fc-muted">{t(ready ? 'e2e.settings.ready' : 'e2e.settings.locked')}</p>
      {ready && !asking && (
        <button type="button" onClick={() => setAsking(true)} className="px-3 py-1.5 text-xs bg-fc-hover text-white rounded-lg">
          {t('e2e.settings.regenerate')}
        </button>
      )}
      {asking && (
        <form onSubmit={regenerate} className="space-y-2">
          <p className="text-xs text-fc-muted">{t('e2e.settings.regenerateDesc')}</p>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} required autoFocus autoComplete="current-password"
            aria-label={t('auth.password')} placeholder={t('e2e.unlock.passwordPlaceholder')}
            className="w-full bg-fc-hover rounded-lg px-3 py-2 text-sm text-white outline-none" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAsking(false); setPw('') }} className="flex-1 py-2 bg-fc-hover rounded-lg text-fc-muted text-sm">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={busy || !pw} className="flex-1 py-2 bg-fc-accent rounded-lg text-white text-sm disabled:opacity-50">
              {busy ? t('e2e.preparing') : t('e2e.settings.regenerate')}
            </button>
          </div>
        </form>
      )}
      {code && <RecoveryCodeModal code={code} onDone={() => setCode(null)} />}
    </div>
  )
}

/** Code de sécurité partagé avec `userId` : identique sur les deux écrans si personne ne s'interpose. */
export function SafetyCode({ userId }: { userId: string }) {
  const t = useT()
  const ready = useAccountKey(s => s.status === 'ready')
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (ready) safetyCodeWith(userId).then(c => { if (alive) setCode(c) })
    return () => { alive = false }
  }, [userId, ready])
  return (
    <div className="bg-fc-channel rounded-xl p-5 mt-4">
      <h2 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <ShieldCheck size={13} aria-hidden /> {t('e2e.safety.title')}
      </h2>
      {code ? (
        <>
          <div className="grid grid-cols-4 gap-2 font-mono text-sm text-white mb-2" aria-label={t('e2e.safety.title')}>
            {groups(code).map((g, i) => <span key={i}>{g}</span>)}
          </div>
          <p className="text-xs text-fc-muted">{t('e2e.safety.desc')}</p>
        </>
      ) : (
        <p className="text-xs text-fc-muted">{t(ready ? 'e2e.safety.none' : 'e2e.settings.locked')}</p>
      )}
    </div>
  )
}
