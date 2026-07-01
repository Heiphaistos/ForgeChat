import { useState, useRef, useEffect } from 'react'
import { Bell, X, AtSign, Hash } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'

interface MentionItem {
  message_id: string
  channel_id: string
  channel_name: string
  server_id: string
  server_name: string
  author_id: string
  author_username: string
  author_avatar: string | null
  content: string
  created_at: string
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'à l\'instant'
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)}min`
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)}h`
  return `il y a ${Math.floor(diff / 86400)}j`
}

function truncate(text: string, max = 80): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const qc = useQueryClient()

  const { data: mentions = [] } = useQuery<MentionItem[]>({
    queryKey: ['user_mentions'],
    queryFn: () => api.get('/user/mentions').then(r => r.data),
    refetchInterval: 30_000,
  })

  const markRead = useMutation({
    mutationFn: (channelId: string) => api.post(`/channels/${channelId}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user_mentions'] }),
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const count = mentions.length

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`p-1.5 rounded hover:bg-fc-hover transition relative ${
          open ? 'text-white bg-fc-hover' : 'text-fc-muted hover:text-white'
        }`}
        title={`Mentions (${count})`}
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-80 bg-fc-channel border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <AtSign size={14} className="text-fc-accent" />
              <span className="text-sm font-semibold text-white">Mentions récentes</span>
            </div>
            <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition">
              <X size={14} />
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {mentions.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={28} className="text-fc-muted mx-auto mb-2 opacity-50" />
                <p className="text-fc-muted text-sm">Aucune mention récente</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {mentions.map(m => (
                  <button
                    key={m.message_id}
                    onClick={() => {
                      nav(`/servers/${m.server_id}/channels/${m.channel_id}?highlight=${m.message_id}`)
                      markRead.mutate(m.channel_id)
                      setOpen(false)
                    }}
                    className="w-full text-left px-4 py-3 hover:bg-fc-hover/50 transition"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center font-bold text-xs text-white overflow-hidden flex-shrink-0 mt-0.5">
                        {m.author_avatar
                          ? <img src={m.author_avatar} alt="" className="w-full h-full object-cover" />
                          : m.author_username.charAt(0).toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs font-semibold text-white">{m.author_username}</span>
                          <span className="text-[10px] text-fc-muted">dans</span>
                          <span className="flex items-center gap-0.5 text-[10px] text-fc-muted">
                            <Hash size={9} />
                            {m.channel_name}
                          </span>
                          <span className="text-[10px] text-fc-muted ml-auto">{timeAgo(m.created_at)}</span>
                        </div>
                        <p className="text-xs text-fc-muted leading-relaxed">{truncate(m.content)}</p>
                        <p className="text-[10px] text-fc-muted/60 mt-0.5">{m.server_name}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {mentions.length > 0 && (
            <div className="px-4 py-2 border-t border-white/10">
              <button
                onClick={() => {
                  mentions.forEach(m => markRead.mutate(m.channel_id))
                }}
                className="text-xs text-fc-accent hover:underline"
              >
                Tout marquer comme lu
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
