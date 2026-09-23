import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'

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
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
  }, [])
  return (
    <div className="flex items-center justify-center min-h-screen overflow-y-auto bg-fc-bg px-4 py-8">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md">
        {token ? <ResetForm token={token} /> : <RequestForm />}
        <p className="text-center mt-4">
          <Link to="/login" className="text-xs text-fc-muted hover:text-white transition">← Retour à la connexion</Link>
        </p>
      </div>
    </div>
  )
}

function RequestForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err: any) {
      toast.error(err.response?.status === 429 ? 'Trop de demandes, réessaie plus tard' : (err.response?.data?.error ?? 'Erreur'))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <>
        <h1 className="text-2xl font-bold text-white text-center mb-2">Vérifie ta boîte mail</h1>
        <p className="text-fc-muted text-center text-sm">
          Si un compte correspond à <span className="text-white">{email}</span>, un lien de réinitialisation
          vient d'être envoyé. Il expire dans 30 minutes.
        </p>
      </>
    )
  }
  return (
    <>
      <h1 className="text-2xl font-bold text-white text-center mb-2">Mot de passe oublié</h1>
      <p className="text-fc-muted text-center mb-6 text-sm">Saisis l'e-mail de ton compte : tu recevras un lien pour choisir un nouveau mot de passe.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="fp-email" className="block text-xs font-semibold text-fc-muted uppercase mb-1">Email</label>
          <input id="fp-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
            autoComplete="email" inputMode="email" placeholder="email@exemple.com" className={inputCls} />
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50">
          {loading ? 'Envoi...' : 'Envoyer le lien'}
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) { toast.error('Les mots de passe ne correspondent pas'); return }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: pw })
      toast.success('Mot de passe modifié. Tous tes appareils ont été déconnectés.')
      nav('/login')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Lien invalide ou expiré')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-white text-center mb-6">Nouveau mot de passe</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="rp-pw" className="block text-xs font-semibold text-fc-muted uppercase mb-1">Nouveau mot de passe</label>
          <input id="rp-pw" type="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={8} maxLength={128}
            autoFocus autoComplete="new-password" className={inputCls} />
        </div>
        <div>
          <label htmlFor="rp-pw2" className="block text-xs font-semibold text-fc-muted uppercase mb-1">Confirmer</label>
          <input id="rp-pw2" type="password" value={pw2} onChange={e => setPw2(e.target.value)} required minLength={8} maxLength={128}
            autoComplete="new-password" className={inputCls} />
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded transition disabled:opacity-50">
          {loading ? 'Enregistrement...' : 'Changer le mot de passe'}
        </button>
      </form>
    </>
  )
}
