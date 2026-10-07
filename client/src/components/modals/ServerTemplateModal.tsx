import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT, type Key } from '../../i18n'

interface ServerTemplate {
  id: string
  name: Key
  description: Key
  icon: string
  channels: Array<{ name: string; type: 'text' | 'voice' | 'announcement' }>
  categories: string[]
}

const TEMPLATES: ServerTemplate[] = [
  {
    id: 'gaming',
    name: 'tpl.gaming',
    icon: '🎮',
    description: 'tpl.gaming.desc',
    categories: ['Texte', 'Vocal'],
    channels: [
      { name: 'général', type: 'text' },
      { name: 'annonces', type: 'announcement' },
      { name: 'recherche-équipe', type: 'text' },
      { name: 'stratégie', type: 'text' },
      { name: 'Voice', type: 'voice' },
      { name: 'Gaming', type: 'voice' },
    ],
  },
  {
    id: 'community',
    name: 'tpl.community',
    icon: '🌍',
    description: 'tpl.community.desc',
    categories: ['Info', 'Discussion'],
    channels: [
      { name: 'accueil', type: 'text' },
      { name: 'annonces', type: 'announcement' },
      { name: 'général', type: 'text' },
      { name: 'aide', type: 'text' },
      { name: 'Vocal général', type: 'voice' },
    ],
  },
  {
    id: 'devteam',
    name: 'tpl.devteam',
    icon: '💻',
    description: 'tpl.devteam.desc',
    categories: ['Général', 'Vocal'],
    channels: [
      { name: 'général', type: 'text' },
      { name: 'projets', type: 'text' },
      { name: 'code-review', type: 'text' },
      { name: 'bugs', type: 'text' },
      { name: 'standup', type: 'text' },
      { name: 'Dev call', type: 'voice' },
    ],
  },
  {
    id: 'music',
    name: 'tpl.music',
    icon: '🎵',
    description: 'tpl.music.desc',
    categories: ['Texte', 'Vocal'],
    channels: [
      { name: 'découvertes', type: 'text' },
      { name: 'playlists', type: 'text' },
      { name: 'concerts', type: 'text' },
      { name: 'Écoute ensemble', type: 'voice' },
    ],
  },
  {
    id: 'education',
    name: 'tpl.education',
    icon: '📚',
    description: 'tpl.education.desc',
    categories: ['Info', 'Travail'],
    channels: [
      { name: 'annonces', type: 'announcement' },
      { name: 'ressources', type: 'text' },
      { name: 'questions', type: 'text' },
      { name: 'projets', type: 'text' },
      { name: 'Étude', type: 'voice' },
    ],
  },
]

interface Props {
  onClose: () => void
}

export default function ServerTemplateModal({ onClose }: Props) {
  const t = useT()
  useEscapeKey(onClose)
  const [selected, setSelected] = useState<ServerTemplate | null>(null)
  const [name, setName] = useState('')
  const [step, setStep] = useState<'grid' | 'name'>('grid')
  const nav = useNavigate()
  const qc = useQueryClient()

  const createServer = useMutation({
    mutationFn: async ({ serverName, template }: { serverName: string; template: ServerTemplate }) => {
      const res = await api.post('/servers', { name: serverName })
      const serverId = res.data.id
      for (const ch of template.channels) {
        // POST /servers crée déjà #général : le recréer donnait deux canaux homonymes.
        if (ch.name === 'général') continue
        try {
          await api.post(`/servers/${serverId}/channels`, { name: ch.name, type: ch.type })
        } catch {
          // ignore individual channel failures
        }
      }
      return res
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(t('servers.create.fromTemplateOk'))
      nav(`/servers/${res.data.id}`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('servers.create.error')),
  })

  const handleSelect = (tpl: ServerTemplate) => {
    setSelected(tpl)
    setName(t(tpl.name))
    setStep('name')
  }

  const handleCreate = () => {
    if (!selected || !name.trim()) return
    createServer.mutate({ serverName: name.trim(), template: selected })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0" onClick={onClose}>
      <div
        className="bg-fc-channel rounded-xl shadow-2xl w-full max-w-[520px] max-h-[90dvh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-template-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-fc-hover">
          <div>
            {step === 'name' && selected && (
              <button
                onClick={() => setStep('grid')}
                className="text-fc-muted hover:text-white transition text-sm mr-3"
                aria-label={t('common.back')}
              >
                ←
              </button>
            )}
            <span id="server-template-modal-title" className="text-lg font-bold text-white">
              {step === 'grid' ? t('servers.create.chooseTemplate') : t('servers.create.template', { name: `${selected?.icon} ${selected ? t(selected.name) : ''}` })}
            </span>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-hover transition">
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Grid */}
        {step === 'grid' && (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-sm text-fc-muted mb-4">{t('servers.create.gridIntro')}</p>
            <div className="grid grid-cols-1 gap-3">
              {TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  onClick={() => handleSelect(tpl)}
                  className="flex items-start gap-4 p-4 bg-fc-bg hover:bg-fc-hover rounded-xl text-left transition border border-transparent hover:border-fc-accent/40 group"
                >
                  <span className="text-3xl flex-shrink-0 mt-0.5">{tpl.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-white group-hover:text-fc-accent transition">{t(tpl.name)}</div>
                    <div className="text-xs text-fc-muted mt-0.5">{t(tpl.description)}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tpl.channels.map(ch => (
                        <span key={ch.name} className="text-[10px] bg-fc-hover px-1.5 py-0.5 rounded text-fc-muted">
                          {ch.type === 'voice' ? '🔊' : ch.type === 'announcement' ? '📢' : '#'} {ch.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Name step */}
        {step === 'name' && selected && (
          <div className="p-5">
            <p className="text-sm text-fc-muted mb-4">
              {t('servers.create.willCreateAuto', { n: selected.channels.length })}
            </p>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1.5">
              {t('servers.create.name')}
            </label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t(selected.name)}
              maxLength={100}
              enterKeyHint="done"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input border border-fc-hover rounded-lg text-white outline-none focus:border-fc-accent mb-4"
              onKeyDown={e => e.key === 'Enter' && name.trim() && handleCreate()}
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || createServer.isPending}
                className="px-4 py-2 bg-fc-accent hover:bg-fc-accent/80 disabled:opacity-50 text-white rounded-lg text-sm transition font-medium"
              >
                {createServer.isPending ? t('common.creating') : t('servers.create.submit')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
