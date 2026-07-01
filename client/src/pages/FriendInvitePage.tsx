import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import api from '../api/client'
import toast from 'react-hot-toast'
import { UserPlus } from 'lucide-react'

interface InviteInfo {
  code: string
  user: {
    id: string
    username: string
    discriminator: string
    avatar: string | null
    status: string
  }
}

export default function FriendInvitePage() {
  const { code } = useParams<{ code: string }>()
  const nav = useNavigate()
  const { user } = useAuth()
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    api.get(`/friend-invite/${code}`)
      .then(r => setInfo(r.data))
      .catch(() => toast.error('Invitation invalide ou expirée'))
      .finally(() => setLoading(false))
  }, [code])

  const accept = async () => {
    if (!user) {
      nav('/login', { state: { redirect: `/friend-invite/${code}` } })
      return
    }
    setAccepting(true)
    try {
      await api.post(`/friend-invite/${code}/accept`)
      toast.success(`Tu es maintenant ami(e) avec ${info?.user.username} !`)
      nav('/')
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Erreur')
    } finally {
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-fc-bg">
        <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!info) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-fc-bg">
        <div className="bg-fc-channel p-8 rounded-lg text-center max-w-sm w-full">
          <div className="text-4xl mb-4">😕</div>
          <h2 className="text-white font-bold text-xl mb-2">Invitation invalide</h2>
          <p className="text-fc-muted text-sm mb-4">Ce lien est expiré ou n'existe pas.</p>
          <button onClick={() => nav('/')} className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm transition">
            Retour à l'accueil
          </button>
        </div>
      </div>
    )
  }

  const isOwn = user?.id === info.user.id

  return (
    <div className="flex items-center justify-center min-h-screen bg-fc-bg">
      <div className="bg-fc-channel p-8 rounded-lg shadow-xl w-full max-w-sm text-center">
        <p className="text-fc-muted text-sm mb-6">t'invite à rejoindre ses amis sur</p>
        <div className="text-2xl font-bold text-white mb-6">ForgeChat</div>

        {/* Avatar */}
        <div className="relative inline-block mb-4">
          <div className="w-20 h-20 rounded-full bg-fc-accent flex items-center justify-center text-white text-3xl font-bold mx-auto overflow-hidden">
            {info.user.avatar
              ? <img src={info.user.avatar} alt="" className="w-full h-full object-cover" />
              : info.user.username.charAt(0).toUpperCase()}
          </div>
          <div className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-fc-channel
            ${info.user.status === 'online' ? 'bg-green-500' : info.user.status === 'idle' ? 'bg-yellow-400' : info.user.status === 'dnd' ? 'bg-red-500' : 'bg-gray-500'}`} />
        </div>

        <div className="font-bold text-white text-lg mb-1">{info.user.username}</div>
        <div className="text-fc-muted text-sm mb-6">#{info.user.discriminator}</div>

        {isOwn ? (
          <div className="text-fc-muted text-sm p-3 bg-fc-hover rounded-lg mb-4">
            C'est ton propre lien d'invitation.
          </div>
        ) : (
          <button
            onClick={accept}
            disabled={accepting}
            className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-medium rounded
                       transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <UserPlus size={18} />
            {accepting
              ? 'Ajout...'
              : user
              ? 'Accepter l\'invitation'
              : 'Se connecter pour accepter'}
          </button>
        )}

        <button onClick={() => nav('/')} className="mt-3 text-sm text-fc-muted hover:text-white transition">
          Retour à l'accueil
        </button>
      </div>
    </div>
  )
}
