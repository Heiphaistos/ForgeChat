import { useState } from 'react'
import { Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { LOCK_DELAYS, useAppLock, validCode, type LockDelay } from '../../lib/appLock'
import { useT } from '../../i18n'
import { Select } from './shared'

/** Réglage « verrouiller après inactivité » (code local à l'appareil). */
export default function AppLockSection() {
  const t = useT()
  const config = useAppLock(s => s.config)
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState('')
  const [confirm, setConfirm] = useState('')
  const [delay, setDelay] = useState<LockDelay>(5)

  const delays = LOCK_DELAYS.map(d => ({ value: String(d), label: t('lock.delay', { n: d }) }))

  const enable = async () => {
    if (!validCode(code)) { toast.error(t('lock.codeRule')); return }
    if (code !== confirm) { toast.error(t('lock.mismatch')); return }
    await useAppLock.getState().enable(code, delay)
    setEditing(false); setCode(''); setConfirm('')
    toast.success(t('lock.enabled'))
  }

  return (
    <div className="p-4 bg-fc-channel rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <Lock size={16} className="text-fc-accent" aria-hidden />
        <h3 className="text-sm font-semibold text-white">{t('lock.section')}</h3>
      </div>
      <p className="text-xs text-fc-muted">{t('lock.hint')}</p>

      {config ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-white">{t('lock.after')}</span>
          <Select value={String(config.delay)} options={delays} label={t('lock.after')}
            onChange={v => useAppLock.getState().setDelay(Number(v) as LockDelay)} />
          <button onClick={() => useAppLock.getState().lockNow()}
            className="px-3 py-2 rounded-lg bg-fc-hover text-white text-sm">{t('lock.now')}</button>
          <button onClick={() => { useAppLock.getState().disable(); toast.success(t('lock.disabled')) }}
            className="px-3 py-2 rounded-lg bg-fc-red/80 text-white text-sm">{t('lock.disable')}</button>
        </div>
      ) : editing ? (
        <div className="space-y-2">
          <input type="password" value={code} onChange={e => setCode(e.target.value)} maxLength={32}
            autoComplete="new-password" placeholder={t('lock.newCode')} aria-label={t('lock.newCode')}
            className="w-full bg-fc-hover rounded-lg px-3 py-2 text-white text-sm outline-none" />
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={32}
            autoComplete="new-password" placeholder={t('lock.confirmCode')} aria-label={t('lock.confirmCode')}
            className="w-full bg-fc-hover rounded-lg px-3 py-2 text-white text-sm outline-none" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-white">{t('lock.after')}</span>
            <Select value={String(delay)} options={delays} label={t('lock.after')} onChange={v => setDelay(Number(v) as LockDelay)} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="flex-1 py-2 bg-fc-hover rounded-lg text-fc-muted text-sm">
              {t('common.cancel')}
            </button>
            <button onClick={() => void enable()} className="flex-1 py-2 bg-fc-accent rounded-lg text-white text-sm font-medium">
              {t('lock.enable')}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="px-3 py-2 rounded-lg bg-fc-accent text-white text-sm font-medium">
          {t('lock.enable')}
        </button>
      )}
    </div>
  )
}
