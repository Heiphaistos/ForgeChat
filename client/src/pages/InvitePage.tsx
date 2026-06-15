import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import api from '../api/client'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

export default function InvitePage() {
  const { code } = useParams<{ code: string }>()
  const { user, loading } = useAuth()
  const nav = useNavigate()
  const [serverInfo, setServerInfo] = useState<any>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)

  useEffect(() => {
    api.get(`/invites/${code}`)
      .then(r => setServerInfo(r.data))
      .catch(() => toast.error('Invitation invalide ou expirée'))
      .finally(() => setLoadingInfo(false))
  }, [code])

  const join = useMutation({
    mutationFn: () => api.post(`/servers/join/${code}`),
    onSuccess: (res) => {
      toast.success(`Bienvenue sur ${res.data.name} !`)
      nav(`/servers/${res.data.id}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  if (loading || loadingInfo) {
    return (
      <div className="flex items-center justify-center h-screen bg-fc-bg">
        <div className="w-8 h-8 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!serverInfo) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-fc-bg text-fc-muted">
        <p className="text-xl font-semibold text-white mb-2">Invitation invalide</p>
        <p className="mb-4">Ce lien a expiré ou n'existe pas.</p>
        <button onClick={() => nav('/')} className="px-4 py-2 bg-fc-accent text-white rounded text-sm">
          Retour à l'accueil
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center h-screen bg-fc-bg">
      <div className="bg-fc-channel rounded-lg p-8 w-full max-w-sm shadow-2xl text-center">
        <div className="w-16 h-16 rounded-2xl bg-fc-accent flex items-center justify-center font-bold text-2xl text-white mx-auto mb-4">
          {serverInfo.server.icon
            ? <img src={serverInfo.server.icon} alt="" className="w-full h-full rounded-2xl object-cover" />
            : serverInfo.server.name.charAt(0)}
        </div>
        <p className="text-fc-muted text-sm mb-1">Tu as été invité(e) à rejoindre</p>
        <h1 className="text-2xl font-bold text-white mb-1">{serverInfo.server.name}</h1>
        <p className="text-fc-muted text-sm mb-6">{serverInfo.server.member_count} membre(s)</p>

        {user ? (
          <button
            onClick={() => join.mutate()}
            disabled={join.isPending}
            className="w-full py-2.5 bg-fc-green hover:bg-green-600 text-white font-semibold rounded-lg transition disabled:opacity-50"
          >
            {join.isPending ? 'Connexion...' : 'Accepter l\'invitation'}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-fc-muted text-sm">Connecte-toi pour rejoindre ce serveur.</p>
            <button
              onClick={() => nav(`/login?redirect=/invite/${code}`)}
              className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white font-semibold rounded-lg transition"
            >
              Se connecter
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
