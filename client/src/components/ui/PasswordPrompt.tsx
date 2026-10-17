import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { passwordProof } from '../../e2e/accountKey'

type Proof = Awaited<ReturnType<typeof passwordProof>>
interface Req { message: string; resolve: (p: Proof | null) => void }

let _pending: Req | null = null
let _listener: (() => void) | null = null

/**
 * Demande le mot de passe (action sensible : 2FA, export de données) et rend la preuve à joindre
 * au corps de la requête (`{auth}`, jamais le mot de passe sauf compte non migré) ; null = annulé.
 */
export function askPasswordProof(message: string): Promise<Proof | null> {
  return new Promise(resolve => { _pending = { message, resolve }; _listener?.() })
}

export function PasswordPrompt() {
  const t = useT()
  const [req, setReq] = useState<Req | null>(null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    _listener = () => { setPw(''); setReq(_pending) }
    return () => { _listener = null }
  }, [])

  if (!req) return null
  const done = (p: Proof | null) => { req.resolve(p); setReq(null); _pending = null }
  const submit = async () => {
    if (!pw || busy) return
    setBusy(true)
    try { done(await passwordProof(pw)) } catch { done(null) } finally { setBusy(false); setPw('') }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => done(null)} aria-hidden />
      <form role="dialog" aria-modal="true" aria-labelledby="pwp-msg"
        onSubmit={e => { e.preventDefault(); void submit() }}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); done(null) } }}
        className="relative bg-fc-channel border border-white/10 rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4">
        <p id="pwp-msg" className="text-fc-muted text-sm text-center leading-relaxed">{req.message}</p>
        <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)}
          placeholder={t('pwp.password')} aria-label={t('pwp.password')} autoComplete="current-password"
          className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm focus:ring-2 focus:ring-fc-accent" />
        <div className="flex gap-3">
          <button type="button" onClick={() => done(null)}
            className="flex-1 px-4 py-2 rounded-lg bg-fc-hover text-fc-text text-sm font-medium transition">{t('common.cancel')}</button>
          <button type="submit" disabled={!pw || busy}
            className="flex-1 px-4 py-2 rounded-lg bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium transition disabled:opacity-50">{t('pwp.confirm')}</button>
        </div>
      </form>
    </div>
  )
}
