import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import { MIN_PASSWORD, deriveSecrets, newKdfSalt, passwordProblem } from '../e2e/authKdf'
import { pwnedProblem } from '../e2e/pwned'
import { useT } from '../i18n'

const inputCls =
  'w-full px-3 py-2 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent'

// Le jeton arrive dans le fragment (#token=...) : jamais transmis au serveur web ni en Referer.
// Lu une fois puis retiré de la barre d'adresse et de l'historique.
function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
}

/** /forgot-password : demande du lien ; /reset-password#token=... : nouveau mot de passe. */
export default function PasswordResetPage() {
  const [token] = useState(tokenFromHash)
  const t = useT()
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  return (
    <div className="flex items-center justify-center min-h-screen overflow-y-auto bg-fc-bg px-4 py-8">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        {token ? <ResetForm token={token} /> : <RequestForm />}
        <p className="text-center mt-4">
          <Link to="/login" className="text-xs text-fc-muted hover:text-white transition">{t('auth.reset.backToLogin')}</Link>
        </p>
      </div>
    </div>
  )
}

function RequestForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const t = useT()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err: any) {
      toast.error(err.response?.status === 429 ? t('auth.reset.tooMany') : (err.response?.data?.error ?? t('auth.reset.error')))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <>
        <h1 className="text-2xl font-bold text-white text-center mb-2">{t('auth.reset.checkMail')}</h1>
        <p className="text-fc-muted text-center text-sm">
          {t('auth.reset.sentBefore')} <span className="text-white">{email}</span>{t('auth.reset.sentAfter')}
        </p>
      </>
    )
  }
  return (
    <>
      <h1 className="text-2xl font-bold text-white text-center mb-2">{t('auth.reset.title')}</h1>
      <p className="text-fc-muted text-center mb-6 text-sm">{t('auth.reset.intro')}</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="fp-email" className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.email')}</label>
          <input id="fp-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
            autoComplete="email" inputMode="email" placeholder={t('auth.emailPlaceholder')} className={inputCls} />
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50">
          {loading ? t('auth.reset.sending') : t('auth.reset.send')}
        </button>
      </form>
    </>
  )
}

function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const t = useT()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) { toast.error(t('auth.passwordMismatch')); return }
    setLoading(true)
    const problem = passwordProblem(pw) ?? await pwnedProblem(pw)
    if (problem) { toast.error(problem); setLoading(false); return }
    try {
      // Le nouveau mot de passe ne part pas : seulement sa preuve et le nouveau sel.
      const new_kdf_salt = newKdfSalt()
      const s = await deriveSecrets(pw, new_kdf_salt, 'argon2id')
      s.wrapKey.fill(0)
      await api.post('/auth/reset-password', { token, new_auth: s.auth, new_kdf_salt, new_kdf: 'argon2id' })
      toast.success(t('auth.reset.done'))
      nav('/login')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? t('auth.reset.invalid'))
    } finally {
      setPw(''); setPw2('')
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-white text-center mb-6">{t('auth.reset.newPassword')}</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="rp-pw" className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.reset.newPassword')}</label>
          <input id="rp-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={MIN_PASSWORD} maxLength={128} placeholder={t('auth.register.passwordPlaceholder')}
            autoFocus autoComplete="new-password" className={inputCls} />
        </div>
        <div>
          <label htmlFor="rp-pw2" className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.reset.confirm')}</label>
          <input id="rp-pw2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} required minLength={MIN_PASSWORD} maxLength={128} placeholder={t('auth.register.passwordPlaceholder')}
            autoComplete="new-password" className={inputCls} />
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50">
          {loading ? t('auth.reset.saving') : t('auth.reset.submit')}
        </button>
      </form>
    </>
  )
}
