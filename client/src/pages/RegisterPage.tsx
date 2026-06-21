import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const nav = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await register(username, email, password)
      nav('/')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Erreur lors de l\'inscription')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-fc-bg">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        <h1 className="text-2xl font-bold text-white text-center mb-2">Créer un compte</h1>
        <p className="text-fc-muted text-center mb-6">Rejoins ForgeChat gratuitement</p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Nom d'utilisateur</label>
            <input
              value={username} onChange={e => setUsername(e.target.value)}
              required minLength={2} maxLength={32} autoFocus
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase mb-1">Mot de passe</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required minLength={8}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full py-2 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50"
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
