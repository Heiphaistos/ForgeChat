import { useEffect, useId, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import api from '../api/client'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'
import Logo3D from '../components/Logo3D'
import { LegalLinks } from './LegalPages'
import { t as tr, useT } from '../i18n'
import { MIN_PASSWORD, passwordProblem } from '../e2e/authKdf'

function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (pwd.length === 0) return { score: 0, label: '', color: '' }
  let score = 0
  if (pwd.length >= MIN_PASSWORD) score++
  if (pwd.length >= 12) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  if (score <= 1) return { score, label: tr('auth.register.weak'), color: 'bg-red-500' }
  if (score <= 3) return { score, label: tr('auth.register.medium'), color: 'bg-yellow-500' }
  return { score, label: tr('auth.register.strong'), color: 'bg-green-500' }
}

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [params] = useSearchParams()
  const [inviteCode, setInviteCode] = useState(params.get('code') ?? '')
  // Mode d'inscription du site : « invite » (code obligatoire), « closed » ou « open ».
  const [mode, setMode] = useState<'open' | 'invite' | 'closed'>('invite')
  const { register } = useAuth()
  const nav = useNavigate()
  const t = useT()
  const id = useId()

  useEffect(() => {
    api.get('/auth/registration-info').then(r => setMode(r.data.mode)).catch(() => { /* serveur injoignable : on laisse le champ affiché */ })
  }, [])

  const strength = getPasswordStrength(password)
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) {
      toast.error(t('auth.passwordMismatch'))
      return
    }
    if (!acceptedTerms) {
      toast.error(t('auth.register.acceptTerms'))
      return
    }
    const problem = passwordProblem(password, [username, email])
    if (problem) { toast.error(problem); return }
    setLoading(true)
    try {
      await register(username, email, password, inviteCode)
      // Le mot de passe ne reste pas dans l'écran : la clé est créée après la vérification de l'adresse.
      setPassword(''); setConfirmPassword('')
      nav('/verify-email', { state: { email: email.trim() } })
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? err?.message ?? t('auth.register.error'))
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
        <h1 className="text-2xl font-bold text-white text-center mb-2">{t('auth.register.title')}</h1>
        <p className="text-fc-muted text-center mb-6">{t('auth.register.subtitle')}</p>

        {mode === 'closed' && (
          <p role="alert" className="mb-4 rounded bg-red-500/10 border border-red-500/40 text-red-300 text-sm px-3 py-2">
            {t('reg.closed')}
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === 'invite' && (
            <div>
              <label htmlFor={`${id}-invite`} className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('reg.inviteLabel')}</label>
              <input
                id={`${id}-invite`}
                aria-describedby={`${id}-invite-hint`}
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                required
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                className="w-full px-3 py-2 bg-fc-input rounded text-white text-base font-mono tracking-widest outline-none focus:ring-2 focus:ring-fc-accent"
              />
              <p id={`${id}-invite-hint`} className="text-xs text-fc-muted mt-1">{t('reg.inviteHint')}</p>
            </div>
          )}
          <div>
            <label htmlFor={`${id}-username`} className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.register.username')}</label>
            <input
              id={`${id}-username`}
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={32}
              type="text"
              autoFocus={mode !== 'invite'}
              autoComplete="username"
              placeholder={t('auth.register.usernamePlaceholder')}
              enterKeyHint="next"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full px-3 py-2 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <div>
            <label htmlFor={`${id}-email`} className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.email')}</label>
            <input
              id={`${id}-email`}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder={t('auth.emailPlaceholder')}
              enterKeyHint="next"
              inputMode="email"
              className="w-full px-3 py-2 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={`${id}-password`} className="block text-xs font-semibold text-fc-muted uppercase">{t('auth.password')}</label>
              {strength.label && (
                <span className={`text-xs font-medium ${
                  strength.score <= 1 ? 'text-red-400' : strength.score <= 3 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {strength.label}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                id={`${id}-password`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD}
                autoComplete="new-password"
                placeholder={t('auth.register.passwordPlaceholder')}
                enterKeyHint="next"
                className="w-full px-3 py-2 pr-10 bg-fc-input rounded text-white text-base outline-none focus:ring-2 focus:ring-fc-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white transition"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {password.length > 0 && (
              <div className="flex gap-1 mt-1.5">
                {[1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      i <= strength.score ? strength.color : 'bg-fc-hover'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-confirm`} className="block text-xs font-semibold text-fc-muted uppercase mb-1">{t('auth.register.confirm')}</label>
            <input
              id={`${id}-confirm`}
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder={t('auth.register.confirmPlaceholder')}
              enterKeyHint="done"
              className={`w-full px-3 py-2 bg-fc-input rounded text-white text-base outline-none focus:ring-2 ${
                passwordMismatch ? 'focus:ring-red-500 ring-1 ring-red-500/50' : 'focus:ring-fc-accent'
              }`}
            />
            {passwordMismatch && (
              <p className="text-xs text-red-400 mt-1">{t('auth.passwordMismatch')}</p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm text-fc-muted">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
              required
              className="mt-1 accent-indigo-500"
            />
            <span>
              {t('auth.register.termsBefore')}{' '}
              <Link to="/cgu" target="_blank" className="text-fc-accent hover:underline">{t('auth.register.termsLink')}</Link>
              {' '}{t('auth.register.termsMiddle')}{' '}
              <Link to="/confidentialite" target="_blank" className="text-fc-accent hover:underline">{t('auth.register.privacyLink')}</Link>.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || passwordMismatch || !acceptedTerms || mode === 'closed'}
            className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50"
          >
            {loading ? t('auth.register.submitting') : t('auth.register.title')}
          </button>
        </form>

        <p className="text-fc-muted text-sm text-center mt-4">
          {t('auth.register.haveAccount')}{' '}
          <Link to="/login" className="text-fc-accent hover:underline">{t('auth.login.submit')}</Link>
        </p>
        <p className="text-center mt-3">
          <Link to="/" className="text-xs text-fc-muted hover:text-white transition">{t('auth.backHome')}</Link>
        </p>
        <LegalLinks className="mt-3" />
      </div>
    </div>
  )
}
