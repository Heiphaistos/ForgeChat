import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Zap, Copy, Trash2 } from 'lucide-react'
import { useAuth } from '../../store/auth'
import api from '../../api/client'
import toast from 'react-hot-toast'

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${value ? 'bg-fc-accent' : 'bg-fc-hover'}`}
    >
      <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
    </button>
  )
}

interface Props {
  user: { id: string; username: string }
}

export default function AdvancedSection({ user }: Props) {
  const nav = useNavigate()
  const { logout } = useAuth()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteInput, setDeleteInput] = useState('')
  const [devMode, setDevMode] = useState(() => localStorage.getItem('fc_dev_mode') === 'true')

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/users/me'),
    onSuccess: async () => { await logout(); nav('/login') },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur suppression'),
  })

  const { data: sessions = [] } = useQuery({
    queryKey: ['user-sessions'],
    queryFn: () => api.get('/user/sessions').then(r => r.data).catch(() => []),
  })

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/user/sessions/${sessionId}`),
    onSuccess: () => toast.success('Session révoquée'),
  })

  const exportData = () => {
    api.get('/user/export').then(r => {
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `forgechat-export-${user.username}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    }).catch(() => toast.error('Export non disponible'))
  }

  const toggleDevMode = (v: boolean) => {
    setDevMode(v)
    localStorage.setItem('fc_dev_mode', String(v))
    toast.success(v ? 'Mode développeur activé' : 'Mode développeur désactivé')
  }

  const resetAllSettings = () => {
    if (!window.confirm('Réinitialiser tous les paramètres ? Cette action est irréversible.')) return
    localStorage.removeItem('fc_theme')
    localStorage.removeItem('fc_audio_settings')
    localStorage.removeItem('fc_dev_mode')
    toast.success('Paramètres réinitialisés')
    setTimeout(() => location.reload(), 800)
  }

  return (
    <div className="space-y-6">
      {/* Mode développeur */}
      <div className="flex items-center justify-between p-4 bg-fc-channel rounded-xl border border-fc-hover">
        <div>
          <div className="text-sm font-medium text-white flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" /> Mode développeur
          </div>
          <div className="text-xs text-fc-muted">Affiche les IDs, logs de debug, infos WebSocket</div>
        </div>
        <Toggle value={devMode} onChange={toggleDevMode} />
      </div>

      {devMode && (
        <div className="bg-fc-channel rounded-xl p-4 border border-yellow-500/20">
          <p className="text-xs text-yellow-400 font-semibold mb-2">Infos développeur</p>
          <div className="space-y-1 text-xs font-mono text-fc-muted">
            <div>UserID: <span className="text-white select-all">{user.id}</span></div>
            <div>Version: <span className="text-white">v3.1.0</span></div>
            <div>UA: <span className="text-white">{navigator.userAgent.slice(0, 50)}...</span></div>
            <div>WS: <span className="text-green-400">Connected</span></div>
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(user.id); toast.success('ID copié') }}
            className="mt-2 flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition"
          >
            <Copy size={12} /> Copier l'ID utilisateur
          </button>
        </div>
      )}

      {/* Cache */}
      <div className="border-t border-fc-hover pt-4">
        <h3 className="text-sm font-semibold text-white mb-3">Cache local</h3>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { localStorage.clear(); toast.success('Cache vidé'); setTimeout(() => location.reload(), 800) }}
            className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition"
          >
            Vider le cache
          </button>
          <button
            onClick={exportData}
            className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition flex items-center gap-1.5"
          >
            <Zap size={13} /> Exporter mes données
          </button>
          <button
            onClick={resetAllSettings}
            className="px-4 py-2 bg-fc-hover text-white rounded-lg text-sm hover:bg-fc-hover/80 transition"
          >
            Réinitialiser les paramètres
          </button>
        </div>
      </div>

      {/* Sessions actives */}
      <div className="border-t border-fc-hover pt-4">
        <h3 className="text-sm font-semibold text-white mb-3">Sessions actives</h3>
        {(sessions as any[]).length === 0 ? (
          <div className="p-3 bg-fc-channel rounded-xl text-xs text-fc-muted">
            <p>Aucune session active supplémentaire.</p>
            <p className="mt-1 opacity-60">Fonctionnalité de sessions cross-device à venir.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(sessions as any[]).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-fc-channel rounded-xl border border-fc-hover">
                <div>
                  <div className="text-sm text-white">{s.device ?? 'Appareil inconnu'}</div>
                  <div className="text-xs text-fc-muted">{s.ip} · {s.last_seen}</div>
                </div>
                <button
                  onClick={() => revokeSession.mutate(s.id)}
                  className="text-xs text-red-400 hover:text-red-300 transition"
                >
                  Révoquer
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Zone dangereuse */}
      <div className="border-t border-fc-hover pt-4">
        <h3 className="text-sm font-semibold text-fc-red mb-1">Zone dangereuse</h3>
        <p className="text-xs text-fc-muted mb-3">La suppression du compte est irréversible.</p>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-2 px-4 py-2 bg-fc-red/10 text-fc-red rounded-lg text-sm hover:bg-fc-red/20 transition"
          >
            <Trash2 size={14} /> Supprimer mon compte
          </button>
        ) : (
          <div className="space-y-3 p-4 border border-fc-red/40 rounded-xl">
            <p className="text-sm text-white">Tapez <strong>{user.username}</strong> pour confirmer</p>
            <input
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              className="w-full bg-fc-channel border border-fc-red/40 rounded-lg px-3 py-2 text-sm text-white focus:border-fc-red outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmDelete(false); setDeleteInput('') }}
                className="flex-1 py-2 border border-fc-hover text-fc-muted rounded-lg text-sm hover:text-white transition"
              >
                Annuler
              </button>
              <button
                onClick={() => deleteAccount.mutate()}
                disabled={deleteInput !== user.username || deleteAccount.isPending}
                className="flex-1 py-2 bg-fc-red text-white rounded-lg text-sm disabled:opacity-50 transition hover:bg-fc-red/80"
              >
                {deleteAccount.isPending ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
