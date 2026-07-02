import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (pwd.length === 0) return { score: 0, label: '', color: '' }
  let score = 0
  if (pwd.length >= 8) score++
  if (pwd.length >= 12) score++
  if (/[A-Z]/.test(pwd)) score++
  if (/[0-9]/.test(pwd)) score++
  if (/[^A-Za-z0-9]/.test(pwd)) score++
  if (score <= 1) return { score, label: 'Faible', color: 'bg-red-500' }
  if (score <= 3) return { score, label: 'Moyen', color: 'bg-yellow-500' }
  return { score, label: 'Fort', color: 'bg-green-500' }
}

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const nav = useNavigate()

  const strength = getPasswordStrength(password)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await register(username, email, password)
      nav('/friends')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Erreur lors de l\'inscription')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-fc-bg px-4">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-white text-center mb-2">Créer un compte</h1>
        <p className="text-fc-muted text-center mb-6">Rejoins ForgeChat gratuitement</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Nom d'utilisateur</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={32}
              autoFocus
              autoComplete="username"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-fc-muted uppercase">Mot de passe</label>
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
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-10 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fc-muted hover:text-white transition"
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
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

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50"
          >
            {loading ? 'Création...' : 'Créer un compte'}
          </button>
        </form>

        <p className="text-fc-muted text-sm text-center mt-4">
          Déjà un compte ?{' '}
          <Link to="/login" className="text-fc-accent hover:underline">Se connecter</Link>
        </p>
        <p className="text-center mt-3">
          <Link to="/" className="text-xs text-fc-muted hover:text-white transition">← Retour à l'accueil</Link>
        </p>
      </div>
    </div>
  )
}
