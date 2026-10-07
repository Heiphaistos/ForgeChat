import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Check, ExternalLink } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, type Key } from '../../i18n'

interface ConnectedAccount {
  id: string
  platform: string
  platform_username: string
  platform_url: string | null
  verified: boolean
}

// placeholder : clé i18n, ou identifiant (username, @username) que translate renvoie tel quel.
const PLATFORMS: { id: string; label: string; icon: string; placeholder: string; urlTemplate?: string }[] = [
  { id: 'github', label: 'GitHub', icon: '🐙', placeholder: 'username', urlTemplate: 'https://github.com/{username}' },
  { id: 'twitter', label: 'Twitter / X', icon: '𝕏', placeholder: '@username' },
  { id: 'steam', label: 'Steam', icon: '🎮', placeholder: 'settings.connected.steamPh' },
  { id: 'spotify', label: 'Spotify', icon: '🎵', placeholder: 'settings.connected.spotifyPh' },
  { id: 'youtube', label: 'YouTube', icon: '▶️', placeholder: 'settings.connected.youtubePh' },
  { id: 'twitch', label: 'Twitch', icon: '💜', placeholder: 'username', urlTemplate: 'https://twitch.tv/{username}' },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼', placeholder: 'settings.connected.linkedinPh' },
  { id: 'reddit', label: 'Reddit', icon: '🟠', placeholder: 'u/username', urlTemplate: 'https://reddit.com/user/{username}' },
  { id: 'instagram', label: 'Instagram', icon: '📸', placeholder: '@username' },
  { id: 'tiktok', label: 'TikTok', icon: '🎬', placeholder: '@username' },
]

export default function ConnectedAccountsSection() {
  const t = useT()
  const qc = useQueryClient()
  const [adding, setAdding] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [url, setUrl] = useState('')

  const { data: accounts = [] } = useQuery<ConnectedAccount[]>({
    queryKey: ['connected-accounts'],
    queryFn: () => api.get('/user/connected-accounts').then(r => r.data),
    staleTime: 30_000,
  })

  const addMutation = useMutation({
    mutationFn: (platform: string) => {
      const meta = PLATFORMS.find(p => p.id === platform)
      const cleanUsername = username.trim()
      // Si l'URL n'est pas renseignée et que la plateforme a un template
      // (github/twitch/reddit), la dériver du username plutôt que de
      // laisser le lien externe invisible faute de champ optionnel rempli.
      const derivedUrl = url.trim() ||
        (meta?.urlTemplate ? meta.urlTemplate.replace('{username}', cleanUsername.replace(/^[@/]+/, '')) : null)
      return api.post('/user/connected-accounts', {
        platform,
        platform_username: cleanUsername,
        platform_url: derivedUrl,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connected-accounts'] })
      toast.success(t('settings.connected.added'))
      setAdding(null)
      setUsername('')
      setUrl('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  const deleteMutation = useMutation({
    mutationFn: (platform: string) => api.delete(`/user/connected-accounts/${platform}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connected-accounts'] })
      toast.success(t('settings.connected.removed'))
    },
  })

  const getConnected = (platformId: string) =>
    accounts.find(a => a.platform === platformId)

  const platformMeta = PLATFORMS.find(p => p.id === adding)

  return (
    <div className="space-y-4">
      <p className="text-sm text-fc-muted">
        {t('settings.connected.intro')}
      </p>

      <div className="space-y-2">
        {PLATFORMS.map(platform => {
          const connected = getConnected(platform.id)
          return (
            <div
              key={platform.id}
              className="flex items-center justify-between p-3 bg-fc-channel rounded-xl border border-fc-hover"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl w-8 text-center">{platform.icon}</span>
                <div>
                  <div className="text-sm font-medium text-white">{platform.label}</div>
                  {connected && (
                    <div className="flex items-center gap-1.5 text-xs text-fc-muted">
                      <span className="streamer-blur">{connected.platform_username}</span>
                      {connected.verified && <Check size={10} className="text-fc-green" />}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {connected?.platform_url && (
                  <a
                    href={connected.platform_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('settings.connected.open', { name: platform.label })}
                    className="p-1.5 text-fc-muted hover:text-white rounded transition"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
                {connected ? (
                  <button
                    onClick={() => deleteMutation.mutate(platform.id)}
                    disabled={deleteMutation.isPending}
                    aria-label={t('settings.connected.disconnect', { name: platform.label })}
                    className="p-1.5 text-fc-red hover:bg-fc-red/10 rounded transition"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => setAdding(platform.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-fc-accent/20 hover:bg-fc-accent/30 text-fc-accent rounded-lg transition"
                  >
                    <Plus size={12} /> {t('settings.connected.connect')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal d'ajout */}
      {adding && platformMeta && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setAdding(null)}>
          <div
            className="bg-fc-sidebar rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-white">
              {t('settings.connected.title', { name: platformMeta.label })} {platformMeta.icon}
            </h3>

            <div>
              <label className="text-xs text-fc-muted mb-1 block">{t('settings.account.username')}</label>
              <input
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t(platformMeta.placeholder as Key)}
                enterKeyHint="next"
                autoCapitalize="none"
                className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white placeholder-fc-muted focus:border-fc-accent outline-none"
              />
            </div>

            <div>
              <label className="text-xs text-fc-muted mb-1 block">{t('settings.connected.url')}</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://..."
                enterKeyHint="done"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="off"
                className="w-full bg-fc-channel border border-fc-hover rounded-lg px-3 py-2 text-sm text-white placeholder-fc-muted focus:border-fc-accent outline-none"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setAdding(null); setUsername(''); setUrl('') }}
                className="flex-1 py-2 rounded-lg border border-fc-hover text-fc-muted hover:text-white text-sm transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => addMutation.mutate(adding)}
                disabled={!username.trim() || addMutation.isPending}
                className="flex-1 py-2 rounded-lg bg-fc-accent hover:bg-fc-accent/80 text-white text-sm font-medium transition disabled:opacity-50"
              >
                {addMutation.isPending ? t('settings.connected.connecting') : t('settings.connected.connect')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
