import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { useAppLock, watchInactivity } from '../lib/appLock'
import { useAuth } from '../store/auth'
import { useT } from '../i18n'

/** Écran opaque de verrouillage par code local (web et bureau), monté quand un compte est connecté. */
export default function AppLockOverlay({ userId }: { userId: string }) {
  const t = useT()
  const locked = useAppLock(s => s.locked)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    useAppLock.getState().load(userId)
    const stop = watchInactivity()
    return () => { stop(); useAppLock.getState().load(null) }
  }, [userId])

  useEffect(() => { if (locked) { setCode(''); setError(''); setTimeout(() => input.current?.focus(), 30) } }, [locked])

  if (!locked) return null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !code) return
    setBusy(true)
    const ok = await useAppLock.getState().unlock(code)
    setBusy(false)
    if (ok) return
    setCode('')
    const wait = Math.ceil((useAppLock.getState().retryAt - Date.now()) / 1000)
    setError(wait > 0 ? t('lock.wait', { s: wait }) : t('lock.wrong'))
  }

  // Code oublié : la déconnexion efface le verrou ; le mot de passe du compte prouve qu'on est bien soi.
  const forgot = async () => {
    useAppLock.getState().disable()
    await useAuth.getState().logout()
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="app-lock-title"
      className="fixed inset-0 z-[10000] bg-fc-bg flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col items-center gap-4 text-center">
        <Lock size={36} className="text-fc-accent" aria-hidden />
        <h2 id="app-lock-title" className="text-white text-lg font-semibold">{t('lock.title')}</h2>
        <input
          ref={input} type="password" value={code} onChange={e => setCode(e.target.value)}
          autoComplete="off" maxLength={32} aria-label={t('lock.code')}
          placeholder={t('lock.code')}
          className="w-full px-3 py-2 rounded-lg bg-fc-channel border border-fc-hover text-white text-center tracking-widest outline-none focus:border-fc-accent"
        />
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !code}
          className="w-full py-2 rounded-lg bg-fc-accent text-white font-medium disabled:opacity-50">
          {t('lock.unlock')}
        </button>
        <button type="button" onClick={() => void forgot()} className="text-xs text-fc-muted hover:text-white underline">
          {t('lock.forgot')}
        </button>
      </form>
    </div>
  )
}
