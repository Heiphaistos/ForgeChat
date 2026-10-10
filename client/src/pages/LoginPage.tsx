import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { LegalLinks } from './LegalPages'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'
import Logo3D from '../components/Logo3D'
import { useT } from '../i18n'
import { SavedAccountsLogin } from '../components/AccountSwitcher'

// Dans l'application bureau, « / » redirige vers /login : le lien bouclerait sur lui-même.
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export default function LoginPage() {
  // Dernière adresse utilisée : seul le mot de passe reste à saisir (ou à coller depuis le gestionnaire).
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('fc_last_email') ?? '' } catch { return '' } })
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()
  const t = useT()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password, needTotp ? totpCode : undefined)
      setPassword('')
      try { localStorage.setItem('fc_last_email', email.trim()) } catch { /* stockage indisponible */ }
      const redirect = searchParams.get('redirect')
      nav(redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/friends')
    } catch (err: any) {
      const msg = err.response?.data?.error ?? ''
      if (msg === 'totp_required') {
        setNeedTotp(true)
        setTotpCode('')
        toast(t('auth.login.enterTotp'))
      } else {
        setPassword('')
        setNeedTotp(false)
        toast.error(msg || t(err?.message === 'AUTH_DOWNGRADE' ? 'auth.login.downgrade' : 'auth.login.error'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen overflow-y-auto bg-fc-bg px-4 py-8">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-center mb-4">
          <Logo3D size={56} />
        </div>
        <h1 className="text-2xl font-bold text-white text-center mb-2">{t('auth.login.title')}</h1>
        <p className="text-fc-muted text-center mb-6">{t('auth.login.subtitle')}</p>

        <SavedAccountsLogin />
        <form onSubmit={submit} className="space-y-4">
          {!needTotp ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.email')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus={!email}
                  autoComplete="username"
                  placeholder={t('auth.emailPlaceholder')}
                  enterKeyHint="next"
                  inputMode="email"
                  className="w-full px-3 py-2 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.password')}</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    autoFocus={!!email}
                    placeholder="••••••••"
                    enterKeyHint="done"
                    className="w-full px-3 py-2 pr-10 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white transition"
                    aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <p className="text-fc-muted text-sm mb-3">
                {t('auth.login.totpHelp')}
              </p>
              <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.login.totpLabel')}</label>
              <input
                type="text"
                inputMode="text"
                maxLength={9}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/[^0-9a-fA-F-]/g, ''))}
                autoFocus
                placeholder="000000"
                autoComplete="one-time-code"
                enterKeyHint="done"
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-center text-xl tracking-widest"
              />
              <button
                type="button"
                onClick={() => setNeedTotp(false)}
                className="mt-2 text-xs text-fc-muted hover:text-white transition"
              >
                {t('auth.login.back')}
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (needTotp && totpCode.length < 6)}
            className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50"
          >
            {loading ? t('auth.login.submitting') : needTotp ? t('auth.login.verifyCode') : t('auth.login.submit')}
          </button>
        </form>

        {!needTotp && (
          <>
            <p className="text-fc-muted text-sm text-center mt-4">
              {t('auth.login.noAccount')}{' '}
              <Link to="/register" className="text-fc-accent hover:underline">{t('auth.login.signUp')}</Link>
            </p>
            <p className="text-fc-muted text-xs text-center mt-2">
              {t('auth.login.forgot')}{' '}
              <Link to="/forgot-password" className="text-fc-accent hover:underline">
                {t('auth.login.reset')}
              </Link>
            </p>
            {!isTauri && (
              <p className="text-center mt-3">
                <Link to="/" className="text-xs text-fc-muted hover:text-white transition">{t('auth.backHome')}</Link>
              </p>
            )}
            <LegalLinks className="mt-2" />
          </>
        )}
      </div>
    </div>
  )
}
