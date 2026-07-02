import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const nav = useNavigate()
  const [searchParams] = useSearchParams()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password, needTotp ? totpCode : undefined)
      const redirect = searchParams.get('redirect')
      nav(redirect && redirect.startsWith('/') ? redirect : '/friends')
    } catch (err: any) {
      const msg = err.response?.data?.error ?? ''
      if (msg === 'totp_required') {
        setNeedTotp(true)
        setTotpCode('')
        toast('Entrez votre code 2FA')
      } else {
        toast.error(msg || 'Erreur de connexion')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-fc-bg">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-white text-center mb-2">Content de te revoir !</h1>
        <p className="text-fc-muted text-center mb-6">Connecte-toi à ton compte ForgeChat</p>

        <form onSubmit={submit} className="space-y-4">
          {!needTotp ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Email</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  required autoFocus
                  className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Mot de passe</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
                />
              </div>
            </>
          ) : (
            <div>
              <p className="text-fc-muted text-sm mb-3">
                La double authentification est activée. Entrez votre code depuis l'application d'authentification.
              </p>
              <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Code 2FA</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                placeholder="000000"
                className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-center text-xl tracking-widest"
              />
              <button
                type="button"
                onClick={() => setNeedTotp(false)}
                className="mt-2 text-xs text-fc-muted hover:text-white transition"
              >
                ← Retour
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (needTotp && totpCode.length < 6)}
            className="w-full py-2 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50"
          >
            {loading ? 'Connexion...' : needTotp ? 'Valider le code' : 'Se connecter'}
          </button>
        </form>

        {!needTotp && (
          <>
            <p className="text-fc-muted text-sm text-center mt-4">
              Pas de compte ?{' '}
              <Link to="/register" className="text-fc-accent hover:underline">S'inscrire</Link>
            </p>
            <p className="text-center mt-3">
              <Link to="/" className="text-xs text-fc-muted hover:text-white transition">← Retour à l'accueil</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
