import { useEffect, useState } from 'react'
import { Plus, X, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { mediaUrl } from '../api/client'
import { forgetAccount, listAccounts, MAX_OTHER_ACCOUNTS, stashCurrent, switchTo, type SavedAccount } from '../lib/accounts'
import { useAuth } from '../store/auth'
import { useT } from '../i18n'

function Avatar({ a }: { a: SavedAccount }) {
  return (
    <span className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white overflow-hidden flex-shrink-0">
      {a.avatar ? <img src={mediaUrl(a.avatar)} alt="" className="w-full h-full object-cover" /> : a.username.charAt(0).toUpperCase()}
    </span>
  )
}

/** Comptes de cette appli : bascule rapide, ajout, retrait (web et bureau). */
export default function AccountSwitcher() {
  const t = useT()
  const me = useAuth(s => s.user)
  const [others, setOthers] = useState<SavedAccount[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { void listAccounts().then(setOthers) }, [])
  if (!me) return null

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await fn() } catch { toast.error(t('accounts.error')) } finally { setBusy(false) }
  }
  const add = () => run(async () => {
    await stashCurrent(me)
    window.location.assign('/login?add=1')
  })

  return (
    <div className="px-2 pb-2 border-t border-white/5 pt-2">
      <p className="px-1 pb-1 text-[10px] text-fc-muted uppercase font-semibold tracking-wide">{t('accounts.title')}</p>
      <div className="flex items-center gap-2 px-1 py-1.5">
        <Avatar a={me} />
        <span className="flex-1 min-w-0 text-xs text-white truncate">{me.username}</span>
        <Check size={14} className="text-fc-green" aria-label={t('accounts.active')} />
      </div>
      {others.map(a => (
        <div key={a.id} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-fc-hover">
          <button disabled={busy} onClick={() => run(() => switchTo(a.id, me))}
            className="flex-1 min-w-0 flex items-center gap-2 text-left disabled:opacity-50"
            title={t('accounts.switchTo', { name: a.username })}>
            <Avatar a={a} />
            <span className="text-xs text-fc-text truncate">{a.username}</span>
          </button>
          <button disabled={busy} onClick={() => run(async () => { await forgetAccount(a.id); setOthers(o => o.filter(x => x.id !== a.id)) })}
            aria-label={t('accounts.forget', { name: a.username })} className="p-1 text-fc-muted hover:text-white">
            <X size={12} />
          </button>
        </div>
      ))}
      {others.length < MAX_OTHER_ACCOUNTS && (
        <button disabled={busy} onClick={() => void add()}
          className="w-full flex items-center gap-2 px-1 py-1.5 rounded-lg text-xs text-fc-muted hover:text-white hover:bg-fc-hover disabled:opacity-50">
          <Plus size={14} /> {t('accounts.add')}
        </button>
      )}
    </div>
  )
}

/** Page de connexion : reprendre un compte déjà connecté dans ce navigateur. */
export function SavedAccountsLogin() {
  const t = useT()
  const [list, setList] = useState<SavedAccount[]>([])
  useEffect(() => { void listAccounts().then(setList) }, [])
  if (list.length === 0) return null
  return (
    <div className="mb-4 space-y-1">
      <p className="text-xs text-fc-muted">{t('accounts.resume')}</p>
      {list.map(a => (
        <button key={a.id} onClick={() => switchTo(a.id, null).catch(() => toast.error(t('accounts.error')))}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-fc-channel hover:bg-fc-hover text-left">
          <Avatar a={a} />
          <span className="text-sm text-white truncate">{a.username}</span>
        </button>
      ))}
    </div>
  )
}
