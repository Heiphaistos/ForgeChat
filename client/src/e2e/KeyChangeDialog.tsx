// Boîte de dialogue BLOQUANTE « la clé de X a changé » (épinglage TOFU, keyPins.ts) :
// tant qu'elle n'est pas acceptée, rien n'est chiffré vers cette clé.
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import { useT } from '../i18n'
import { useAccountKey } from './accountKey'
import * as c from './crypto'
import { acceptKey, refuseKey, useKeyAlerts } from './keyPins'

const groups = (code: string, n: number) => code.match(new RegExp(`.{1,${n}}`, 'g')) ?? []

export default function KeyChangeDialog() {
  const t = useT()
  const qc = useQueryClient()
  const alert = useKeyAlerts(s => s.alerts[0])
  const myPub = useAccountKey(s => s.pub)
  // Code calculé pour l'empreinte `fp` (une autre alerte peut lui succéder).
  const [safety, setSafety] = useState<{ fp: string; code: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (alert?.kind === 'user' && myPub) {
      c.safetyCode(c.b64uDecode(myPub), c.b64uDecode(alert.pub)).then(v => { if (alive) setSafety({ fp: alert.fp, code: v }) }, () => {})
    }
    return () => { alive = false }
  }, [alert, myPub])

  if (!alert) return null
  const code = safety?.fp === alert.fp ? safety.code : null
  const red = alert.verified || alert.kind === 'server'
  // Nom lisible du serveur (le registre ne connaît que son identifiant).
  const name = alert.kind === 'server'
    ? qc.getQueryData<{ id: string; name: string }[]>(['servers'])?.find(s => `server:${s.id}` === alert.subject)?.name ?? alert.name
    : alert.name
  const fresh = alert.kind === 'server' && alert.fresh === true
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/80 px-4 py-8 overflow-y-auto">
      <div role="alertdialog" aria-modal="true" aria-labelledby="fc-keychange-title"
        className={`bg-fc-channel p-6 rounded-lg shadow-xl w-full max-w-md border ${red ? 'border-red-500' : 'border-fc-yellow/60'}`}>
        <h2 id="fc-keychange-title" className="text-white font-semibold flex items-center gap-2 mb-3">
          <ShieldAlert size={18} className={red ? 'text-red-400' : 'text-fc-yellow'} aria-hidden />
          {t(fresh ? 'e2e.pin.titleServerNew' : alert.kind === 'server' ? 'e2e.pin.titleServer' : 'e2e.pin.title', { name })}
        </h2>
        {alert.verified && <p className="text-sm text-red-300 font-medium mb-2">{t('e2e.pin.verifiedWarn')}</p>}
        <p className="text-sm text-fc-muted mb-3">{t(fresh ? 'e2e.pin.descServerNew' : alert.kind === 'server' ? 'e2e.pin.descServer' : 'e2e.pin.desc')}</p>
        {alert.kind === 'user' && code && (
          <>
            <p className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('e2e.safety.title')}</p>
            <div className="grid grid-cols-4 gap-2 font-mono text-sm text-white mb-3">
              {groups(code, 5).map((g, i) => <span key={i}>{g}</span>)}
            </div>
          </>
        )}
        {alert.kind === 'server' && (
          <>
            <p className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t(fresh ? 'e2e.pin.fingerprintNew' : 'e2e.pin.fingerprint')}</p>
            <p className="font-mono text-xs text-white break-all mb-3">{groups(alert.fp, 4).join(' ')}</p>
          </>
        )}
        <div className="flex flex-col gap-2">
          <button type="button" autoFocus onClick={() => refuseKey(alert)}
            className="w-full py-2.5 bg-fc-hover text-white rounded">{t('e2e.pin.refuse')}</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await acceptKey(alert) } finally { setBusy(false) } }}
            className={`w-full py-2.5 rounded text-white disabled:opacity-50 ${red ? 'bg-red-600 hover:bg-red-500' : 'bg-fc-accent hover:bg-indigo-500'}`}>
            {t(fresh ? 'e2e.pin.acceptServerNew' : 'e2e.pin.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}
