import { useState } from 'react'
import { t as tr } from '../../i18n'
import { Plus, Trash2, Zap } from 'lucide-react'
import PickerShell from '../ui/PickerShell'

const STORAGE_KEY = 'fc_quick_replies'

interface QuickReply {
  id: string
  label: string
  content: string
}

function loadReplies(): QuickReply[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') } catch { return [] }
}

function saveReplies(replies: QuickReply[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(replies))
}

const defaultReplies = (): QuickReply[] => [
  { id: '1', label: tr('sw.qr.thanksLabel'), content: tr('sw.qr.thanks') },
  { id: '2', label: tr('sw.qr.okLabel'), content: tr('sw.qr.ok') },
  { id: '3', label: tr('sw.qr.soonLabel'), content: tr('sw.qr.soon') },
]

interface Props {
  onPick: (content: string) => void
  onClose: () => void
}

export default function QuickReplies({ onPick, onClose }: Props) {
  const [replies, setReplies] = useState<QuickReply[]>(() => {
    const stored = loadReplies()
    return stored.length > 0 ? stored : defaultReplies()
  })
  const [editing, setEditing] = useState(false)

  function handlePick(content: string) {
    onPick(content)
    onClose()
  }

  function handleChange(id: string, field: keyof QuickReply, value: string) {
    setReplies(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function handleDelete(id: string) {
    setReplies(prev => prev.filter(r => r.id !== id))
  }

  function handleAdd() {
    setReplies(prev => [...prev, { id: Date.now().toString(), label: '', content: '' }])
  }

  function handleSave() {
    saveReplies(replies)
    setEditing(false)
  }

  return (
    <PickerShell
      onClose={onClose}
      desktopClassName="absolute bottom-full right-0 mb-2 w-72 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50"
    >
      <div className="px-4 py-3 border-b border-fc-hover flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Zap size={14} className="text-fc-accent" aria-hidden />
          {tr('hc.qr.title')}
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              aria-label={tr('hc.p.qrEdit')}
              className="text-xs text-fc-muted hover:text-white transition"
            >
              Modifier
            </button>
          ) : (
            <button
              onClick={handleSave}
              aria-label={tr('hc.p.qrSave')}
              className="text-xs text-fc-accent hover:text-white transition"
            >
              Sauvegarder
            </button>
          )}
          <button
            onClick={onClose}
            aria-label={tr('hc.p.qrClose')}
            className="text-fc-muted hover:text-white transition"
          >
            <span className="text-sm leading-none" aria-hidden>✕</span>
          </button>
        </div>
      </div>

      <div className="p-2 max-h-72 overflow-y-auto overscroll-contain space-y-1">
        {replies.map(reply => (
          <div key={reply.id}>
            {!editing ? (
              <button
                onClick={() => handlePick(reply.content)}
                aria-label={tr('hc.qr.reply', { x: reply.label || reply.content || tr('hc.qr.empty') })}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-fc-muted hover:text-white hover:bg-fc-hover transition truncate"
              >
                {reply.label || reply.content || '(vide)'}
              </button>
            ) : (
              <div className="flex flex-col gap-1 px-2 py-1 rounded-lg bg-fc-hover">
                <div className="flex items-center gap-1">
                  <input
                    value={reply.label}
                    onChange={e => handleChange(reply.id, 'label', e.target.value)}
                    placeholder={tr('hc.p.qrLabelPh')}
                    aria-label={tr('hc.p.qrLabel')}
                    enterKeyHint="next"
                    autoCapitalize="sentences"
                    className="flex-1 bg-fc-input text-white text-xs rounded px-2 py-1 outline-none border border-fc-hover focus:border-fc-accent"
                  />
                  <button
                    onClick={() => handleDelete(reply.id)}
                    aria-label={tr('hc.p.qrDelete')}
                    className="p-1 text-fc-muted hover:text-red-400 transition flex-shrink-0"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                <textarea
                  value={reply.content}
                  onChange={e => handleChange(reply.id, 'content', e.target.value)}
                  placeholder={tr('hc.p.qrContentPh')}
                  aria-label={tr('hc.p.qrContent')}
                  rows={2}
                  className="w-full bg-fc-input text-white text-xs rounded px-2 py-1 outline-none border border-fc-hover focus:border-fc-accent resize-none"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="px-3 pb-3">
          <button
            onClick={handleAdd}
            aria-label={tr('hc.p.qrAdd')}
            className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition w-full px-2 py-1.5 rounded-lg hover:bg-fc-hover"
          >
            <Plus size={13} aria-hidden />
            Ajouter
          </button>
        </div>
      )}
    </PickerShell>
  )
}
