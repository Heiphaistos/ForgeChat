import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import api from '../api/client'
import { useT } from '../i18n'

// Lien « ce n'est pas moi » de l'e-mail de nouvel appareil (amélioration n° 25) :
// /verrouiller#token=… — jeton dans le fragment (jamais envoyé au serveur web ni en Referer),
// lu une fois puis retiré de la barre d'adresse. Verrouille aussitôt, sans session.
function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
}

export default function LockAccountPage() {
  const t = useT()
  const [token] = useState(tokenFromHash)
  const [state, setState] = useState<'pending' | 'done' | 'invalid' | 'missing'>(token ? 'pending' : 'missing')
  const sent = useRef(false)

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
    if (!token || sent.current) return
    sent.current = true
    api.post('/auth/panic', { token })
      .then(() => setState('done'))
      .catch(() => setState('invalid'))
  }, [token])

  return (
    <div className="flex items-center justify-center min-h-screen overflow-y-auto bg-fc-bg px-4 py-8">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-md text-center space-y-4">
        <ShieldAlert size={40} className={`mx-auto ${state === 'done' ? 'text-fc-green' : 'text-fc-red'}`} />
        <h1 className="text-2xl font-bold text-white">{t('guard.lock.title')}</h1>
        {state === 'pending' && <p className="text-fc-muted text-sm">{t('guard.lock.pending')}</p>}
        {state === 'missing' && <p className="text-fc-muted text-sm">{t('guard.lock.missing')}</p>}
        {state === 'invalid' && <p className="text-fc-muted text-sm">{t('guard.lock.invalid')}</p>}
        {state === 'done' && (
          <>
            <p className="text-white text-sm">{t('guard.lock.done')}</p>
            <p className="text-fc-muted text-sm">{t('guard.lock.next')}</p>
            <Link to="/forgot-password" className="inline-block px-4 py-2 bg-fc-accent rounded text-white text-sm font-medium">
              {t('guard.lock.reset')}
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
