import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Pencil, X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useT, type Key } from '../../i18n'

const DEFAULT_KEYBINDINGS: { action: string; label: Key; default: string }[] = [
  { action: 'toggle_mute', label: 'settings.keys.toggle_mute', default: 'Ctrl+M' },
  { action: 'toggle_deafen', label: 'settings.keys.toggle_deafen', default: 'Ctrl+D' },
  { action: 'push_to_talk', label: 'settings.keys.push_to_talk', default: 'Ctrl+Shift+Space' },
  { action: 'toggle_screen_share', label: 'settings.keys.toggle_screen_share', default: 'Ctrl+Alt+S' },
  { action: 'focus_chat', label: 'settings.keys.focus_chat', default: 'Ctrl+L' },
  { action: 'search', label: 'settings.keys.search', default: 'Ctrl+K' },
  { action: 'next_unread', label: 'settings.keys.next_unread', default: 'Alt+ArrowDown' },
  { action: 'prev_unread', label: 'settings.keys.prev_unread', default: 'Alt+ArrowUp' },
  { action: 'close_modal', label: 'settings.keys.close_modal', default: 'Escape' },
  { action: 'toggle_emoji', label: 'settings.keys.toggle_emoji', default: 'Ctrl+E' },
  { action: 'upload_file', label: 'settings.keys.upload_file', default: 'Ctrl+U' },
  { action: 'toggle_sidebar', label: 'settings.keys.toggle_sidebar', default: 'Ctrl+Alt+M' },
  { action: 'reply', label: 'settings.keys.reply', default: 'R' },
  { action: 'edit_last', label: 'settings.keys.edit_last', default: 'ArrowUp' },
  { action: 'mark_all_read', label: 'settings.keys.mark_all_read', default: 'Ctrl+Shift+A' },
  { action: 'open_settings', label: 'settings.keys.open_settings', default: 'Ctrl+,' },
  { action: 'hand_raise', label: 'settings.keys.hand_raise', default: 'Ctrl+Space' },
  { action: 'toggle_camera', label: 'settings.keys.toggle_camera', default: 'Ctrl+Shift+C' },
  { action: 'clip_stream', label: 'settings.keys.clip_stream', default: 'Alt+C' },
]

function formatKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const key = e.key
  // Modificateur seul : attendre la vraie touche (« Ctrl » seul était enregistré
  // à la première pression).
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return ''
  // ' ' donnait « Ctrl+  », illisible et ignoré par les raccourcis vocaux.
  parts.push(key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

export default function KeybindingsSection() {
  const t = useT()
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
      toast.success(t('settings.keys.saved'))
    },
    onError: () => toast.error(t('common.error')),
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
        {t('settings.keys.intro')}
      </p>

      {capturing && (
        <div className="p-3 bg-fc-accent/10 border border-fc-accent rounded-lg text-sm text-white animate-pulse">
          {preview
            ? t('settings.keys.combo', { combo: preview })
            : t('settings.keys.press')}
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
              <span className="text-sm text-white">{t(kb.label)}</span>

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
                  {isCapturing ? t('common.cancel') : combo}
                </button>

                {custom && (
                  <button
                    onClick={() => resetMutation.mutate(kb.action)}
                    title={t('settings.keys.reset', { combo: kb.default })}
                    aria-label={t('settings.keys.reset', { combo: kb.default })}
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
