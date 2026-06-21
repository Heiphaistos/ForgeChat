import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Pencil, X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'

const DEFAULT_KEYBINDINGS: { action: string; label: string; default: string }[] = [
  { action: 'toggle_mute', label: 'Activer/désactiver le micro', default: 'Ctrl+M' },
  { action: 'toggle_deafen', label: 'Activer/désactiver le casque', default: 'Ctrl+D' },
  { action: 'push_to_talk', label: 'Push-to-Talk', default: 'Alt' },
  { action: 'toggle_screen_share', label: 'Partager l\'écran', default: 'Ctrl+Alt+S' },
  { action: 'focus_chat', label: 'Focus sur le chat', default: 'Ctrl+L' },
  { action: 'search', label: 'Recherche globale', default: 'Ctrl+K' },
  { action: 'next_unread', label: 'Canal non-lu suivant', default: 'Alt+ArrowDown' },
  { action: 'prev_unread', label: 'Canal non-lu précédent', default: 'Alt+ArrowUp' },
  { action: 'close_modal', label: 'Fermer la fenêtre', default: 'Escape' },
  { action: 'toggle_emoji', label: 'Sélecteur d\'emojis', default: 'Ctrl+E' },
  { action: 'upload_file', label: 'Uploader un fichier', default: 'Ctrl+U' },
  { action: 'toggle_sidebar', label: 'Afficher/masquer membres', default: 'Ctrl+Alt+M' },
  { action: 'reply', label: 'Répondre au dernier message', default: 'R' },
  { action: 'edit_last', label: 'Modifier le dernier message', default: 'ArrowUp' },
  { action: 'mark_all_read', label: 'Tout marquer comme lu', default: 'Ctrl+Shift+A' },
  { action: 'open_settings', label: 'Ouvrir les paramètres', default: 'Ctrl+,' },
  { action: 'hand_raise', label: 'Lever/baisser la main', default: 'Ctrl+Space' },
  { action: 'toggle_camera', label: 'Activer/désactiver la caméra', default: 'Ctrl+Shift+C' },
]

function formatKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const key = e.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key)
  }
  return parts.join('+')
}

export default function KeybindingsSection() {
  const qc = useQueryClient()
  const [capturing, setCapturing] = useState<string | null>(null)
  const [preview, setPreview] = useState('')
  const captureRef = useRef<HTMLDivElement>(null)

  const { data: saved = [] } = useQuery<{ action: string; key_combo: string }[]>({
    queryKey: ['keybindings'],
    queryFn: () => api.get('/user/keybindings').then(r => r.data),
    staleTime: 30_000,
  })

  const setMutation = useMutation({
    mutationFn: (data: { action: string; key_combo: string }) =>
      api.post('/user/keybindings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['keybindings'] })
      setCapturing(null)
      setPreview('')
      toast.success('Raccourci enregistré')
    },
    onError: () => toast.error('Erreur'),
  })

  const resetMutation = useMutation({
    mutationFn: (action: string) => api.delete(`/user/keybindings/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keybindings'] }),
  })

  useEffect(() => {
    if (!capturing) return

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      const combo = formatKey(e)
      if (combo && combo !== 'Escape') {
        setPreview(combo)
        setMutation.mutate({ action: capturing, key_combo: combo })
      } else if (combo === 'Escape') {
        setCapturing(null)
        setPreview('')
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [capturing])

  const getCombo = (action: string) => {
    const saved_kb = saved.find(k => k.action === action)
    if (saved_kb) return saved_kb.key_combo
    const def = DEFAULT_KEYBINDINGS.find(k => k.action === action)
    return def?.default ?? '—'
  }

  const isCustom = (action: string) => saved.some(k => k.action === action)

  return (
    <div className="space-y-4" ref={captureRef}>
      <p className="text-sm text-fc-muted">
        Cliquez sur un raccourci pour le modifier, puis appuyez sur la nouvelle combinaison de touches.
      </p>

      {capturing && (
        <div className="p-3 bg-fc-accent/10 border border-fc-accent rounded-lg text-sm text-white animate-pulse">
          {preview
            ? `Combinaison : ${preview} — relâchez pour valider`
            : 'Appuyez sur la nouvelle combinaison... (Échap pour annuler)'}
        </div>
      )}

      <div className="space-y-1">
        {DEFAULT_KEYBINDINGS.map(kb => {
          const combo = getCombo(kb.action)
          const custom = isCustom(kb.action)
          const isCapturing = capturing === kb.action

          return (
            <div
              key={kb.action}
              className={`flex items-center justify-between px-4 py-3 rounded-xl transition ${
                isCapturing
                  ? 'bg-fc-accent/10 border border-fc-accent'
                  : 'bg-fc-channel border border-transparent hover:border-fc-hover'
              }`}
            >
              <span className="text-sm text-white">{kb.label}</span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCapturing(isCapturing ? null : kb.action)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono transition ${
                    isCapturing
                      ? 'bg-fc-accent text-white'
                      : 'bg-fc-bg border border-fc-hover text-white hover:border-fc-accent'
                  }`}
                >
                  {isCapturing ? <X size={10} /> : <Pencil size={10} />}
                  {isCapturing ? 'Annuler' : combo}
                </button>

                {custom && (
                  <button
                    onClick={() => resetMutation.mutate(kb.action)}
                    title={`Remettre par défaut (${kb.default})`}
                    className="p-1.5 text-fc-muted hover:text-white rounded transition"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
