import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import api from '../api/client'
import { Send, Users } from 'lucide-react'
import toast from 'react-hot-toast'

interface GDMMessage {
  id: string
  content: string | null
  created_at: string
  sender_id: string
  sender_username: string
  sender_avatar: string | null
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
  const { on } = useWs()
  const qc = useQueryClient()
  const [content, setContent] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: group } = useQuery<GroupDM>({
    queryKey: ['group-dm', groupId],
    queryFn: () => api.get(`/dms/groups/${groupId}`).then(r => r.data),
    enabled: !!groupId,
  })

  const { data: messages = [] } = useQuery<GDMMessage[]>({
    queryKey: ['group-dm-messages', groupId],
    queryFn: () => api.get(`/dms/groups/${groupId}/messages`).then(r => r.data),
    enabled: !!groupId,
  })

  const sendMsg = useMutation({
    mutationFn: (text: string) =>
      api.post(`/dms/groups/${groupId}/messages`, { content: text }),
    onError: () => toast.error("Erreur d'envoi"),
  })

  // Écouter les nouveaux messages via WS
  useEffect(() => {
    const off = on('GROUP_DM_MESSAGE', (d: any) => {
      if (d.group_id !== groupId) return
      qc.setQueryData<GDMMessage[]>(['group-dm-messages', groupId], prev =>
        prev ? [...prev, d.message] : [d.message]
      )
    })
    return off
  }, [groupId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map(msg => {
            const isMe = msg.sender_id === user?.id
            return (
              <div key={msg.id} className={`flex items-start gap-2.5 ${isMe ? 'flex-row-reverse' : ''}`}>
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
                  <div className={`px-3 py-2 rounded-2xl text-sm break-words ${
                    isMe
                      ? 'bg-fc-accent text-white rounded-tr-sm'
                      : 'bg-fc-channel text-fc-text rounded-tl-sm'
                  }`}>
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-fc-muted mt-0.5 mx-1">
                    {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-fc-hover flex-shrink-0">
          <div className="flex items-center gap-2 bg-fc-input rounded-xl px-3 py-2">
            <input
              type="text"
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
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
