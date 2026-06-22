import { useState, useEffect, useRef } from 'react'
import { X, Hash, Send, MessagesSquare } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useWs } from '../../store/ws'
import toast from 'react-hot-toast'

interface Props {
  serverId: string
  channelId: string
  parentMessageId: string
  onClose: () => void
}

export default function ThreadPanel({ serverId, channelId, parentMessageId, onClose }: Props) {
  const { user } = useAuth()
  const { on } = useWs()
  const [input, setInput] = useState('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const { data: threads = [], isLoading } = useQuery<any[]>({
    queryKey: ['threads', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/threads`).then(r => r.data),
  })

  const thread = threads.find((t: any) => t.parent_message_id === parentMessageId)

  useEffect(() => {
    if (thread) setThreadId(thread.id)
  }, [thread?.id])

  const { data: messages = [] } = useQuery<any[]>({
    queryKey: ['thread-messages', threadId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages`).then(r => r.data),
    enabled: !!threadId,
  })

  // Temps réel — écouter les nouveaux messages du thread via WS
  useEffect(() => {
    if (!threadId) return
    const off = on('THREAD_MESSAGE', (d: any) => {
      if (d.thread_id === threadId || d.parent_id === parentMessageId) {
        qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      }
    })
    return off
  }, [threadId, parentMessageId, on, qc])

  // Scroll to bottom quand les messages changent
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const createThread = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/threads`, {
      title: newTitle.trim() || undefined,
      first_message: input.trim(),
      parent_message_id: parentMessageId,
    }),
    onSuccess: (res) => {
      const tid = res.data.thread?.id
      if (tid) setThreadId(tid)
      qc.invalidateQueries({ queryKey: ['threads', channelId] })
      setInput('')
      setNewTitle('')
      setCreating(false)
      toast.success('Thread créé !')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const sendMessage = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/threads/${threadId}/messages`, {
      content: input.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      setInput('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const handleSend = () => {
    if (!input.trim()) return
    if (!threadId) {
      createThread.mutate()
    } else {
      sendMessage.mutate()
    }
  }

  return (
    <div className="w-80 bg-fc-channel border-l border-fc-bg flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-fc-bg flex-shrink-0">
        <MessagesSquare size={16} className="text-fc-muted" />
        <span className="font-semibold text-white text-sm flex-1">Fil de discussion</span>
        <button onClick={onClose} className="text-fc-muted hover:text-white transition p-1 rounded hover:bg-fc-hover" title="Fermer">
          <X size={16} />
        </button>
      </div>

      {/* Créer thread */}
      {!threadId && !isLoading && (
        <div className="p-3 border-b border-fc-bg bg-fc-bg/30">
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-center text-sm text-fc-accent hover:text-indigo-400 transition py-2"
            >
              + Créer un thread depuis ce message
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Titre du thread (optionnel)"
                className="w-full px-2 py-1.5 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
              />
              <div className="text-xs text-fc-muted">Ou écrivez directement votre premier message ci-dessous</div>
            </div>
          )}
        </div>
      )}

      {/* Thread existant — infos */}
      {thread && (
        <div className="p-3 border-b border-fc-bg bg-fc-accent/5">
          <div className="flex items-center gap-1.5">
            <Hash size={13} className="text-fc-accent" />
            <span className="text-sm font-medium text-white truncate">{thread.title}</span>
          </div>
          <div className="text-xs text-fc-muted mt-0.5">
            par {thread.creator_username} · {thread.message_count} messages
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!threadId && !isLoading && (
          <div className="text-center text-fc-muted text-sm py-8">
            <MessagesSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p>Pas encore de thread</p>
          </div>
        )}

        {threadId && !isLoading && messages.length === 0 && (
          <div className="text-center text-fc-muted text-sm py-8">
            <MessagesSquare size={32} className="mx-auto mb-2 opacity-30" />
            <p>Aucune réponse — soyez le premier !</p>
          </div>
        )}

        {messages.map((msg: any) => (
          <div key={msg.id} className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-0.5 overflow-hidden">
              {msg.author?.avatar
                ? <img src={msg.author.avatar} alt="" className="w-full h-full object-cover" />
                : msg.author?.username?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className={`text-xs font-semibold ${msg.author_id === user?.id || msg.user_id === user?.id ? 'text-fc-accent' : 'text-white'}`}>
                  {msg.author?.username ?? msg.author_username}
                </span>
                <span className="text-xs text-fc-muted">
                  {format(new Date(msg.created_at), 'HH:mm', { locale: fr })}
                </span>
              </div>
              <p className="text-sm text-fc-text leading-relaxed break-words">{msg.content}</p>
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-fc-bg flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={threadId ? 'Répondre au fil...' : 'Premier message du thread...'}
            rows={2}
            className="flex-1 px-2.5 py-2 bg-fc-input rounded-lg text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || createThread.isPending || sendMessage.isPending}
            className="p-2 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50 flex-shrink-0"
            title="Envoyer"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
