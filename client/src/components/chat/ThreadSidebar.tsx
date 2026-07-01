import { useState, useEffect } from 'react'
import { X, MessagesSquare, Plus } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import ThreadItem from '../threads/ThreadItem'
import { useWs } from '../../store/ws'

interface ThreadData {
  id: string
  title: string
  message_count: number
  unread_count?: number
  last_activity?: string | null
  creator_username?: string
  parent_message_id?: string | null
}

interface Props {
  serverId: string
  channelId: string
  onSelectThread: (threadId: string) => void
  onClose: () => void
}

interface NewThreadForm {
  title: string
  firstMessage: string
}

export default function ThreadSidebar({ serverId, channelId, onSelectThread, onClose }: Props) {
  const [showNewModal, setShowNewModal] = useState(false)
  const [form, setForm] = useState<NewThreadForm>({ title: '', firstMessage: '' })
  const qc = useQueryClient()
  const { on } = useWs()

  useEffect(() => {
    const offCreate = on('THREAD_CREATE', (d: any) => {
      if (d.channel_id === channelId) qc.invalidateQueries({ queryKey: ['threads', channelId] })
    })
    const offUpdate = on('THREAD_UPDATE', (d: any) => {
      if (d.channel_id === channelId) qc.invalidateQueries({ queryKey: ['threads', channelId] })
    })
    return () => { offCreate(); offUpdate() }
  }, [channelId, on, qc])

  const { data: threads = [], isLoading } = useQuery<ThreadData[]>({
    queryKey: ['threads', channelId],
    queryFn: () =>
      api.get(`/servers/${serverId}/channels/${channelId}/threads`).then(r => r.data),
    staleTime: 10_000,
  })

  const createThread = useMutation({
    mutationFn: (payload: { title: string; first_message: string }) =>
      api.post(`/servers/${serverId}/channels/${channelId}/threads`, payload),
    onSuccess: (res) => {
      toast.success('Fil créé !')
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
      setShowNewModal(false)
      setForm({ title: '', firstMessage: '' })
      const tid: string | undefined = res.data?.thread?.id
      if (tid) onSelectThread(tid)
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur lors de la création'),
  })

  const handleCreate = () => {
    if (!form.firstMessage.trim()) { toast.error('Le premier message est requis'); return }
    createThread.mutate({
      title: form.title.trim() || 'Nouveau fil',
      first_message: form.firstMessage.trim(),
    })
  }

  return (
    <div className="absolute inset-0 z-10 md:relative md:inset-auto md:z-auto md:w-80 bg-fc-channel border-l border-fc-hover flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-fc-hover flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessagesSquare size={16} className="text-fc-accent" />
          <span className="font-semibold text-white text-sm">Fils de discussion</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewModal(true)}
            className="p-1.5 text-fc-muted hover:text-fc-accent rounded hover:bg-fc-hover transition"
            title="Nouveau fil"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Modal nouveau fil */}
      {showNewModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3 md:px-0"
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="bg-fc-channel rounded-xl w-full max-w-[400px] max-h-[90dvh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-fc-hover">
              <div className="flex items-center gap-2">
                <MessagesSquare size={15} className="text-fc-accent" />
                <h3 className="font-semibold text-white text-sm">Nouveau fil</h3>
              </div>
              <button
                onClick={() => setShowNewModal(false)}
                className="p-1 text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide block mb-1.5">
                  Titre du fil
                </label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ex: Question sur la config"
                  className="w-full px-3 py-2 bg-fc-input border border-fc-hover rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent placeholder-fc-muted"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-fc-muted uppercase tracking-wide block mb-1.5">
                  Premier message <span className="text-fc-red">*</span>
                </label>
                <textarea
                  value={form.firstMessage}
                  onChange={e => setForm(f => ({ ...f, firstMessage: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleCreate()
                  }}
                  placeholder="Écrivez votre premier message..."
                  rows={4}
                  className="w-full px-3 py-2 bg-fc-input border border-fc-hover rounded-lg text-sm text-white outline-none focus:ring-2 focus:ring-fc-accent resize-none placeholder-fc-muted"
                />
                <p className="text-xs text-fc-muted mt-1">Ctrl+Entrée pour valider</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition"
              >
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={createThread.isPending || !form.firstMessage.trim()}
                className="px-4 py-2 text-sm bg-fc-accent hover:bg-indigo-500 text-white rounded-lg font-medium transition disabled:opacity-40"
              >
                {createThread.isPending ? 'Création...' : 'Créer le fil'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste des threads */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isLoading && threads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <MessagesSquare size={36} className="text-fc-muted/30 mb-3" />
            <p className="text-sm text-fc-muted">Aucun fil de discussion</p>
            <p className="text-xs text-fc-muted/70 mt-1">
              Cliquez sur <strong className="text-fc-muted">+</strong> pour en créer un
            </p>
          </div>
        )}

        {threads.map(thread => (
          <ThreadItem
            key={thread.id}
            id={thread.id}
            title={thread.title}
            message_count={thread.message_count}
            unread_count={thread.unread_count}
            last_activity={thread.last_activity}
            creator_username={thread.creator_username}
            onSelect={onSelectThread}
          />
        ))}
      </div>

      {/* Footer — bouton nouveau fil */}
      <div className="p-3 border-t border-fc-hover flex-shrink-0">
        <button
          onClick={() => setShowNewModal(true)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-fc-hover hover:bg-fc-input text-sm text-fc-muted hover:text-white transition"
        >
          <Plus size={14} />
          Nouveau fil
        </button>
      </div>
    </div>
  )
}
