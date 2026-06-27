import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import { useUnread } from '../store/unread'
import api from '../api/client'
import { Send, Users, Loader2, ChevronUp, Trash2, Pencil, Check, X, SmilePlus } from 'lucide-react'
import toast from 'react-hot-toast'
import EmojiPicker from '../components/chat/EmojiPicker'

interface GDMReaction {
  emoji: string
  user_id: string
}

interface GDMMessage {
  id: string
  content: string | null
  created_at: string
  edited_at: string | null
  sender_id: string
  sender_username: string
  sender_avatar: string | null
  reactions?: GDMReaction[]
}

interface GDMMember {
  id: string
  username: string
  avatar: string | null
  status: string
}

interface GroupDM {
  id: string
  name: string
  owner_id: string
  members: GDMMember[]
}

export default function GroupDMPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const { user } = useAuth()
  const { on, send } = useWs()
  const resetUnread = useUnread(s => s.reset)
  const [content, setContent] = useState('')

  const [showMembers, setShowMembers] = useState(false)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<Record<string, { username: string; timer: ReturnType<typeof setTimeout> }>>({})
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSent = useRef(0)
  const [allMessages, setAllMessages] = useState<GDMMessage[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialized = useRef(false)

  const { data: group } = useQuery<GroupDM>({
    queryKey: ['group-dm', groupId],
    queryFn: () => api.get(`/dms/groups/${groupId}`).then(r => r.data),
    enabled: !!groupId,
  })

  const { data: initialMessages } = useQuery<GDMMessage[]>({
    queryKey: ['group-dm-messages', groupId],
    queryFn: () => api.get(`/dms/groups/${groupId}/messages?limit=50`).then(r => r.data),
    enabled: !!groupId,
  })

  // Initialiser les messages une seule fois par groupId
  useEffect(() => {
    if (!initialMessages) return
    initialized.current = false
  }, [groupId])

  // Cleanup des timers typing au démontage
  useEffect(() => {
    return () => {
      setTypingUsers(prev => {
        Object.values(prev).forEach(e => clearTimeout(e.timer))
        return {}
      })
      if (typingDebounce.current) clearTimeout(typingDebounce.current)
    }
  }, [])

  // Effacer le badge non-lu quand on ouvre le groupe (client + serveur)
  useEffect(() => {
    if (!groupId) return
    const markRead = () => {
      resetUnread(groupId)
      api.post(`/dms/groups/${groupId}/read`).catch(() => {})
    }
    markRead()
    window.addEventListener('focus', markRead)
    return () => window.removeEventListener('focus', markRead)
  }, [groupId])

  useEffect(() => {
    if (!initialMessages || initialized.current) return
    initialized.current = true
    setAllMessages(initialMessages)
    setHasMore(initialMessages.length >= 50)
  }, [initialMessages])

  // Écouter les nouveaux messages, suppressions et éditions via WS
  useEffect(() => {
    const offNew = on('GROUP_DM_MESSAGE', (d: any) => {
      if (d.group_id !== groupId) return
      setAllMessages(prev => {
        if (prev.find(m => m.id === d.message.id)) return prev
        return [...prev, d.message]
      })
    })
    const offDelete = on('GROUP_DM_MESSAGE_DELETE', (d: any) => {
      if (d.group_id !== groupId) return
      setAllMessages(prev => prev.filter(m => m.id !== d.message_id))
    })
    const offEdit = on('GROUP_DM_MESSAGE_EDIT', (d: any) => {
      if (d.group_id !== groupId) return
      setAllMessages(prev => prev.map(m =>
        m.id === d.message_id ? { ...m, content: d.content, edited_at: new Date().toISOString() } : m
      ))
    })
    const offReact = on('GROUP_DM_REACTION_TOGGLE', (d: any) => {
      if (d.group_id !== groupId) return
      setAllMessages(prev => prev.map(m => {
        if (m.id !== d.message_id) return m
        const reactions = m.reactions ?? []
        const updated = d.added
          ? [...reactions.filter(r => !(r.emoji === d.emoji && r.user_id === d.user_id)),
             { emoji: d.emoji, user_id: d.user_id }]
          : reactions.filter(r => !(r.emoji === d.emoji && r.user_id === d.user_id))
        return { ...m, reactions: updated }
      }))
    })
    const offTyping = on('TYPING', (d: any) => {
      if (d.conversation_id !== groupId || d.user_id === user?.id) return
      setTypingUsers(prev => {
        const entry = prev[d.user_id]
        if (entry) clearTimeout(entry.timer)
        const timer = setTimeout(() => {
          setTypingUsers(p => {
            const { [d.user_id]: _, ...rest } = p
            return rest
          })
        }, 3000)
        return { ...prev, [d.user_id]: { username: d.username, timer } }
      })
    })
    return () => { offNew(); offDelete(); offEdit(); offReact(); offTyping() }
  }, [groupId, on, user?.id])

  // Scroll to bottom quand nouveaux messages arrivent (pas au load-more)
  const prevLen = useRef(0)
  useEffect(() => {
    const cur = allMessages.length
    if (cur > prevLen.current && cur - prevLen.current === 1) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevLen.current = cur
  }, [allMessages.length])

  // Scroll to bottom au chargement initial
  useEffect(() => {
    if (allMessages.length > 0 && prevLen.current === 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [allMessages.length])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || allMessages.length === 0 || !groupId) return
    setLoadingMore(true)
    try {
      const oldest = allMessages[0]
      const res = await api.get(`/dms/groups/${groupId}/messages?before=${oldest.id}&limit=50`)
      const older: GDMMessage[] = res.data
      if (older.length < 50) setHasMore(false)
      if (older.length > 0) {
        setAllMessages(prev => {
          const ids = new Set(prev.map(m => m.id))
          return [...older.filter(m => !ids.has(m.id)), ...prev]
        })
      } else {
        setHasMore(false)
      }
    } catch {
      toast.error('Erreur de chargement')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, allMessages, groupId])

  const sendMsg = useMutation({
    mutationFn: (text: string) =>
      api.post(`/dms/groups/${groupId}/messages`, { content: text }),
    onError: () => toast.error("Erreur d'envoi"),
  })

  const editMsg = useMutation({
    mutationFn: ({ msgId, content }: { msgId: string; content: string }) =>
      api.patch(`/dms/groups/${groupId}/messages/${msgId}`, { content }),
    onSuccess: () => { setEditingMsgId(null); toast.success('Message modifié') },
    onError: () => toast.error('Impossible de modifier'),
  })

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    try {
      await api.put(`/dms/groups/${groupId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
    } catch {
      toast.error('Impossible d\'ajouter la réaction')
    }
  }, [groupId])

  const submit = () => {
    const t = content.trim()
    if (!t) return
    sendMsg.mutate(t)
    setContent('')
  }

  if (!group) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-fc-hover bg-fc-bg/30 flex-shrink-0">
          <div className="md:hidden w-8 flex-shrink-0" />
          <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {group.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-semibold text-sm truncate">{group.name}</h2>
            <p className="text-xs text-fc-muted">{group.members.length} membres</p>
          </div>
          <button
            onClick={() => setShowMembers(v => !v)}
            className={`p-2 rounded hover:bg-fc-hover transition ${showMembers ? 'text-white' : 'text-fc-muted'}`}
            title="Voir les membres"
          >
            <Users size={18} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center py-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-1.5 text-xs text-fc-muted hover:text-white transition disabled:opacity-50"
              >
                {loadingMore
                  ? <Loader2 size={14} className="animate-spin" />
                  : <ChevronUp size={14} />
                }
                {loadingMore ? 'Chargement...' : 'Charger plus'}
              </button>
            </div>
          )}

          {allMessages.map(msg => {
            const isMe = msg.sender_id === user?.id
            return (
              <div key={msg.id} className={`flex items-start gap-2.5 group ${isMe ? 'flex-row-reverse' : ''}`}>
                <div className="w-8 h-8 rounded-full bg-fc-channel flex-shrink-0 flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                  {msg.sender_avatar
                    ? <img src={msg.sender_avatar} alt="" className="w-full h-full object-cover" />
                    : msg.sender_username.charAt(0).toUpperCase()
                  }
                </div>
                <div className={`max-w-xs ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!isMe && (
                    <span className="text-xs text-fc-muted mb-0.5 ml-1">{msg.sender_username}</span>
                  )}
                  {editingMsgId === msg.id ? (
                    <div className="flex items-end gap-1 w-full max-w-xs">
                      <input
                        value={editContent}
                        onChange={e => setEditContent(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-fc-input rounded-xl text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Escape') setEditingMsgId(null)
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            if (editContent.trim()) editMsg.mutate({ msgId: msg.id, content: editContent.trim() })
                          }
                        }}
                      />
                      <button onClick={() => editContent.trim() && editMsg.mutate({ msgId: msg.id, content: editContent.trim() })}
                        className="p-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg"
                      ><Check size={13} /></button>
                      <button onClick={() => setEditingMsgId(null)}
                        className="p-1.5 text-fc-muted hover:text-white rounded-lg"
                      ><X size={13} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition">
                        <div className="relative">
                          <button
                            onClick={() => setEmojiPickerFor(p => p === msg.id ? null : msg.id)}
                            className="p-1 text-fc-muted hover:text-fc-accent rounded transition"
                            title="Réagir"
                          >
                            <SmilePlus size={12} />
                          </button>
                          {emojiPickerFor === msg.id && (
                            <div className={`absolute z-50 ${isMe ? 'right-0' : 'left-0'} bottom-7`}>
                              <EmojiPicker
                                onPick={emoji => { toggleReaction(msg.id, emoji); setEmojiPickerFor(null) }}
                                onClose={() => setEmojiPickerFor(null)}
                              />
                            </div>
                          )}
                        </div>
                        {isMe && (<>
                          <button
                            onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content ?? '') }}
                            className="p-1 text-fc-muted hover:text-white rounded transition"
                            title="Modifier"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => api.delete(`/dms/groups/${groupId}/messages/${msg.id}`).catch(() => toast.error('Impossible de supprimer'))}
                            className="p-1 text-fc-muted hover:text-red-400 rounded transition"
                            title="Supprimer"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>)}
                      </div>
                      <div className="flex flex-col">
                        <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                          isMe
                            ? 'bg-fc-accent text-white rounded-tr-sm'
                            : 'bg-fc-channel text-fc-text rounded-tl-sm'
                        }`}>
                          {msg.content}
                          {msg.edited_at && <span className="text-[9px] opacity-60 ml-1">(modifié)</span>}
                        </div>
                        {/* Réactions */}
                        {msg.reactions && msg.reactions.length > 0 && (() => {
                          const grouped: Record<string, { count: number; reacted: boolean }> = {}
                          for (const r of msg.reactions) {
                            if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, reacted: false }
                            grouped[r.emoji].count++
                            if (r.user_id === user?.id) grouped[r.emoji].reacted = true
                          }
                          return (
                            <div className={`flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                              {Object.entries(grouped).map(([emoji, { count, reacted }]) => (
                                <button
                                  key={emoji}
                                  onClick={() => toggleReaction(msg.id, emoji)}
                                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition ${
                                    reacted
                                      ? 'bg-fc-accent/20 border-fc-accent/50 text-white'
                                      : 'bg-fc-channel border-fc-hover text-fc-muted hover:border-fc-accent/50'
                                  }`}
                                >
                                  <span>{emoji}</span>
                                  <span>{count}</span>
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                  <span className="text-[10px] text-fc-muted mt-0.5 mx-1">
                    {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Typing indicator */}
        {Object.keys(typingUsers).length > 0 && (
          <div className="px-4 pb-1 text-xs text-fc-muted flex-shrink-0">
            {Object.values(typingUsers).map(u => u.username).join(', ')}
            {Object.keys(typingUsers).length === 1 ? ' est en train d\'écrire...' : ' écrivent...'}
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-fc-hover flex-shrink-0">
          <div className="flex items-center gap-2 bg-fc-input rounded-xl px-3 py-2">
            <input
              type="text"
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return }
                const now = Date.now()
                if (now - lastTypingSent.current > 2000) {
                  lastTypingSent.current = now
                  send({ type: 'TYPING', conversation_id: groupId, is_group: true })
                }
              }}
              placeholder={`Message dans ${group.name}...`}
              className="flex-1 bg-transparent text-sm text-white placeholder:text-fc-muted outline-none"
              maxLength={4000}
            />
            <button
              onClick={submit}
              disabled={!content.trim() || sendMsg.isPending}
              className="p-1.5 text-fc-muted hover:text-fc-accent disabled:opacity-30 transition rounded"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Panneau membres */}
      {showMembers && (
        <div className="w-56 border-l border-fc-hover bg-fc-bg/20 flex-shrink-0 overflow-y-auto py-3">
          <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-3 mb-2">
            Membres ({group.members.length})
          </p>
          {group.members.map(m => (
            <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-fc-hover/40 transition">
              <div className="relative flex-shrink-0">
                <div className="w-7 h-7 rounded-full bg-fc-channel flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                  {m.avatar
                    ? <img src={m.avatar} alt="" className="w-full h-full object-cover" />
                    : m.username.charAt(0).toUpperCase()
                  }
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-fc-bg ${
                  m.status === 'online' ? 'bg-green-400' : 'bg-gray-500'
                }`} />
              </div>
              <span className={`text-sm truncate ${m.id === user?.id ? 'text-fc-accent font-medium' : 'text-fc-text'}`}>
                {m.username}{m.id === user?.id ? ' (moi)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
