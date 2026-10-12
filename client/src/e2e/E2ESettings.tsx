// Réglages > Sécurité : clé de compte E2E ; profils : code de sécurité à comparer.
import { useEffect, useState } from 'react'
import { BadgeCheck, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../store/auth'
import { useT } from '../i18n'
import api from '../api/client'
import { regenerateRecoveryCode, useAccountKey } from './accountKey'
import * as c from './crypto'
import { fpOf, markVerified, pinOf, trustedMembers, useKeyAlerts } from './keyPins'
import { RecoveryCodeModal } from './E2EGate'
import { SafetyQrImage, SafetyQrScanner } from './SafetyQr'
import type { SafetyScan } from './safetyQr'

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
      setPw('')
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

interface Safety { code: string; pub: string; changed: boolean; verified: boolean }

/** Code de sécurité avec la clé servie pour `userId`, comparée à l'empreinte épinglée ; null si l'un n'a pas de clé. */
async function safetyWith(userId: string, mine: string): Promise<Safety | null> {
  try {
    const { data } = await api.get<{ public: string }>(`/users/${userId}/keys/public`)
    // Première vue : épinglée ; clé changée : boîte de dialogue bloquante.
    const trusted = (await trustedMembers([{ user_id: userId, public: data.public }])).length > 0
    const pin = await pinOf(userId)
    const fp = await fpOf(data.public)
    return {
      code: await c.safetyCode(c.b64uDecode(mine), c.b64uDecode(data.public)),
      pub: data.public, changed: !trusted, verified: trusted && pin?.fp === fp && !!pin.verified,
    }
  } catch {
    return null
  }
}

/** Code de sécurité partagé avec `userId` : identique sur les deux écrans si personne ne s'interpose. */
export function SafetyCode({ userId }: { userId: string }) {
  const t = useT()
  const ready = useAccountKey(s => s.status === 'ready')
  const mine = useAccountKey(s => s.pub)
  const [info, setInfo] = useState<Safety | null>(null)
  const [tick, setTick] = useState(0)
  // Nouvelle clé acceptée ou refusée dans la boîte de dialogue : on relit.
  const alerts = useKeyAlerts(s => s.alerts.length)
  useEffect(() => {
    let alive = true
    if (ready && mine) safetyWith(userId, mine).then(v => { if (alive) setInfo(v) })
    return () => { alive = false }
  }, [userId, ready, mine, tick, alerts])
  const verify = async () => {
    if (info && await markVerified(userId, info.pub)) setTick(n => n + 1)
  }
  // Scan en personne (amélioration n° 11) : seule une égalité stricte marque la clé vérifiée.
  const onScan = async (r: SafetyScan) => {
    if (r === 'match') {
      await verify()
      toast.success(t('guard.qr.match'))
    } else {
      toast.error(t(r === 'mismatch' ? 'guard.qr.mismatch' : 'guard.qr.invalid'), { duration: 8000 })
    }
  }
  return (
    <div className="bg-fc-channel rounded-xl p-5 mt-4">
      <h2 className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <ShieldCheck size={13} aria-hidden /> {t('e2e.safety.title')}
      </h2>
      {info ? (
        <>
          <div className="grid grid-cols-4 gap-2 font-mono text-sm text-white mb-2" aria-label={t('e2e.safety.title')}>
            {groups(info.code).map((g, i) => <span key={i}>{g}</span>)}
          </div>
          <p className="text-xs text-fc-muted">{t('e2e.safety.desc')}</p>
          <div className="mt-3 flex flex-col items-start gap-1">
            <SafetyQrImage code={info.code} />
            <p className="text-xs text-fc-muted">{t('guard.qr.hint')}</p>
          </div>
          {info.changed && (
            <p className="text-xs text-red-300 mt-2 flex items-center gap-1"><ShieldAlert size={13} aria-hidden />{t('e2e.safety.changed')}</p>
          )}
          {info.verified && (
            <p className="text-xs text-green-400 mt-2 flex items-center gap-1"><BadgeCheck size={13} aria-hidden />{t('e2e.safety.verified')}</p>
          )}
          {!info.changed && !info.verified && (
            <button type="button" onClick={verify} className="mt-2 px-3 py-1.5 text-xs bg-fc-hover text-white rounded-lg">{t('e2e.safety.verify')}</button>
          )}
          {!info.changed && <SafetyQrScanner code={info.code} onResult={r => void onScan(r)} />}
        </>
      ) : (
        <p className="text-xs text-fc-muted">{t(ready ? 'e2e.safety.none' : 'e2e.settings.locked')}</p>
      )}
    </div>
  )
}
