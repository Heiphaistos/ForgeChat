import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare, Plus, Tag, MessageSquare, ChevronRight, Pin, Lock, X, ArrowLeft, Trash2, Pencil, Check, ChevronLeft } from 'lucide-react'
import api from '../api/client'
import { useFormatDate } from '../hooks/useFormatDate'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import toast from 'react-hot-toast'
import { useMobile } from '../contexts/MobileContext'

interface Props {
  channel: { id: string; name: string; topic?: string }
  serverId: string
  channelId: string
}

interface ForumPost {
  id: string
  title: string
  content?: string
  creator_id: string
  creator_username: string
  creator_avatar?: string
  tags: string[]
  pinned: boolean
  locked: boolean
  reply_count: number
  last_reply_at?: string
  created_at: string
}

interface ForumReply {
  id: string
  user_id: string
  content: string
  created_at: string
  author: { id: string; username: string; avatar?: string; discriminator: string }
}

function CreatePostModal({ serverId, channelId, onClose }: { serverId: string; channelId: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const qc = useQueryClient()

  const create = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/posts`, {
      title: title.trim(),
      content: content.trim() || undefined,
      tags,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
      toast.success('Post créé !')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t) && tags.length < 5) {
      setTags([...tags, t])
      setTagInput('')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-3" onClick={onClose}>
      <div className="bg-fc-channel rounded-lg w-full max-w-[560px] max-h-[90dvh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-fc-bg flex items-start justify-between">
          <h2 className="text-xl font-bold text-white">Nouveau post</h2>
          <button onClick={onClose} className="text-fc-muted hover:text-white transition"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">Titre *</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titre du post..."
              maxLength={200}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">Contenu</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Décrivez votre post..."
              rows={5}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">Tags</label>
            <div className="flex gap-2 mb-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Ajouter un tag..."
                maxLength={20}
                className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
              <button onClick={addTag} className="px-3 py-2 bg-fc-hover text-fc-muted hover:text-white rounded text-sm transition">
                <Plus size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map(t => (
                <span key={t} className="flex items-center gap-1 text-xs px-2 py-1 bg-fc-accent/20 text-fc-accent rounded-full">
                  #{t}
                  <button onClick={() => setTags(tags.filter(x => x !== t))} className="hover:text-white">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 bg-fc-bg/50 rounded-b-lg flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">Annuler</button>
          <button
            onClick={() => title.trim() && create.mutate()}
            disabled={!title.trim() || create.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            {create.isPending ? 'Publication...' : 'Publier'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PostView({ serverId, channelId, post, onBack }: { serverId: string; channelId: string; post: ForumPost; onBack: () => void }) {
  const [reply, setReply] = useState('')
  const [localPost, setLocalPost] = useState(post)
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const qc = useQueryClient()
  const { user } = useAuth()
  const { on } = useWs()
  const { formatShortDate, formatDate } = useFormatDate()

  const togglePin = useMutation({
    mutationFn: () => api.patch(`/servers/${serverId}/channels/${channelId}/posts/${post.id}`, { pinned: !localPost.pinned }),
    onSuccess: () => {
      setLocalPost(p => ({ ...p, pinned: !p.pinned }))
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
      toast.success(localPost.pinned ? 'Post désépinglé' : 'Post épinglé')
    },
    onError: () => toast.error('Permission refusée'),
  })

  const toggleLock = useMutation({
    mutationFn: () => api.patch(`/servers/${serverId}/channels/${channelId}/posts/${post.id}`, { locked: !localPost.locked }),
    onSuccess: () => {
      setLocalPost(p => ({ ...p, locked: !p.locked }))
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
      toast.success(localPost.locked ? 'Post déverrouillé' : 'Post verrouillé')
    },
    onError: () => toast.error('Permission refusée'),
  })

  const { data } = useQuery({
    queryKey: ['forum-post', post.id],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/posts/${post.id}`).then(r => r.data),
  })

  // Sync localPost avec les données fraîches du serveur (ex: lock externe via mod)
  useEffect(() => {
    if (data?.post) {
      setLocalPost(prev => ({ ...prev, pinned: data.post.pinned, locked: data.post.locked }))
    }
  }, [data?.post?.pinned, data?.post?.locked])

  // WS: sync edit/delete des réponses en temps réel
  useEffect(() => {
    const offEdit = on('FORUM_REPLY_EDIT', (d: any) => {
      if (d.post_id !== post.id) return
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
    })
    const offDelete = on('FORUM_REPLY_DELETE', (d: any) => {
      if (d.post_id !== post.id) return
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
    })
    return () => { offEdit(); offDelete() }
  }, [post.id, on, qc])

  const editReply = useMutation({
    mutationFn: ({ replyId, content }: { replyId: string; content: string }) =>
      api.patch(`/servers/${serverId}/channels/${channelId}/posts/${post.id}/replies/${replyId}`, { content }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
      setEditingReplyId(null)
      toast.success('Réponse modifiée')
    },
    onError: () => toast.error('Impossible de modifier'),
  })

  const deleteReply = useMutation({
    mutationFn: (replyId: string) =>
      api.delete(`/servers/${serverId}/channels/${channelId}/posts/${post.id}/replies/${replyId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
      toast.success('Réponse supprimée')
    },
    onError: () => toast.error('Impossible de supprimer'),
  })

  const deletePost = useMutation({
    mutationFn: () =>
      api.delete(`/servers/${serverId}/channels/${channelId}/posts/${post.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
      toast.success('Post supprimé')
      onBack()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Impossible de supprimer'),
  })

  const replies: ForumReply[] = data?.replies ?? []

  const sendReply = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/posts/${post.id}/replies`, {
      content: reply.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
      setReply('')
      toast.success('Réponse ajoutée !')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-fc-bg flex-shrink-0">
        <button onClick={onBack} className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {localPost.pinned && <Pin size={14} className="text-yellow-400 flex-shrink-0" />}
            {localPost.locked && <Lock size={14} className="text-red-400 flex-shrink-0" />}
            <h2 className="font-bold text-white truncate">{localPost.title}</h2>
          </div>
          <p className="text-xs text-fc-muted">par {localPost.creator_username} · {formatDate(localPost.created_at)}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => togglePin.mutate()}
            title={localPost.pinned ? 'Désépingler' : 'Épingler'}
            className={`p-1.5 rounded hover:bg-fc-hover transition ${localPost.pinned ? 'text-yellow-400' : 'text-fc-muted hover:text-yellow-400'}`}
          >
            <Pin size={15} />
          </button>
          <button
            onClick={() => toggleLock.mutate()}
            title={localPost.locked ? 'Déverrouiller' : 'Verrouiller'}
            className={`p-1.5 rounded hover:bg-fc-hover transition ${localPost.locked ? 'text-red-400' : 'text-fc-muted hover:text-red-400'}`}
          >
            <Lock size={15} />
          </button>
          {user && post.creator_id === user.id && (
            <button
              onClick={() => { if (confirm('Supprimer ce post et toutes ses réponses ?')) deletePost.mutate() }}
              disabled={deletePost.isPending}
              title="Supprimer le post"
              className="p-1.5 rounded hover:bg-fc-hover transition text-fc-muted hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Post original */}
        {data?.post?.content && (
          <div className="bg-fc-hover/30 rounded-lg p-4 border border-fc-hover">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                {post.creator_avatar
                  ? <img src={post.creator_avatar} alt="" className="w-full h-full object-cover" />
                  : post.creator_username.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-white">{post.creator_username}</span>
              <span className="text-xs text-fc-muted">{formatShortDate(post.created_at)}</span>
            </div>
            <p className="text-fc-text text-sm leading-relaxed whitespace-pre-wrap">{data.post.content}</p>
          </div>
        )}

        {/* Réponses */}
        {replies.map((r) => (
          <div key={r.id} className="flex gap-3 group">
            <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0 overflow-hidden">
              {r.author.avatar
                ? <img src={r.author.avatar} alt="" className="w-full h-full object-cover" />
                : r.author.username.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-sm font-medium ${r.user_id === user?.id ? 'text-fc-accent' : 'text-white'}`}>
                  {r.author.username}
                </span>
                <span className="text-xs text-fc-muted">{formatShortDate(r.created_at)}</span>
                {r.user_id === user?.id && editingReplyId !== r.id && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 ml-auto transition">
                    <button
                      onClick={() => { setEditingReplyId(r.id); setEditContent(r.content) }}
                      className="p-1 text-fc-muted hover:text-white rounded transition"
                      title="Modifier"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => deleteReply.mutate(r.id)}
                      className="p-1 text-fc-muted hover:text-red-400 rounded transition"
                      title="Supprimer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              {editingReplyId === r.id ? (
                <div className="flex gap-2">
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="flex-1 px-2 py-1 bg-fc-input rounded text-sm text-white outline-none focus:ring-1 focus:ring-fc-accent resize-none"
                    rows={2}
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') setEditingReplyId(null)
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (editContent.trim()) editReply.mutate({ replyId: r.id, content: editContent.trim() })
                      }
                    }}
                  />
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => editContent.trim() && editReply.mutate({ replyId: r.id, content: editContent.trim() })}
                      disabled={!editContent.trim() || editReply.isPending}
                      className="p-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded disabled:opacity-50"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => setEditingReplyId(null)}
                      className="p-1.5 text-fc-muted hover:text-white rounded"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-fc-text leading-relaxed whitespace-pre-wrap">{r.content}</p>
              )}
            </div>
          </div>
        ))}

        {replies.length === 0 && (
          <div className="text-center text-fc-muted py-8 text-sm">Aucune réponse. Soyez le premier !</div>
        )}
      </div>

      {/* Input réponse */}
      {!localPost.locked && (
        <div className="p-4 border-t border-fc-bg flex-shrink-0">
          <div className="flex gap-2">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (reply.trim()) sendReply.mutate()
                }
              }}
              placeholder="Écrire une réponse..."
              rows={2}
              className="flex-1 px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
            />
            <button
              onClick={() => reply.trim() && sendReply.mutate()}
              disabled={!reply.trim() || sendReply.isPending}
              className="px-4 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              Répondre
            </button>
          </div>
        </div>
      )}
      {localPost.locked && (
        <div className="p-3 bg-red-500/10 border-t border-red-500/20 text-center text-xs text-red-400 flex items-center justify-center gap-1 flex-shrink-0">
          <Lock size={12} /> Ce post est verrouillé
        </div>
      )}
    </div>
  )
}

export default function ForumPage({ channel, serverId, channelId }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPost, setSelectedPost] = useState<ForumPost | null>(null)
  const qc = useQueryClient()
  const { on } = useWs()
  const { openSidebar } = useMobile()
  const { formatShortDate, formatDate } = useFormatDate()

  const { data: posts = [] } = useQuery<ForumPost[]>({
    queryKey: ['forum', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/posts`).then(r => r.data),
    enabled: !!channelId,
  })

  useEffect(() => {
    const offCreate = on('FORUM_POST_CREATE', (d: any) => {
      if (d.channel_id === channelId) qc.invalidateQueries({ queryKey: ['forum', channelId] })
    })
    const offUpdate = on('FORUM_POST_UPDATE', (d: any) => {
      if (d.channel_id === channelId) {
        qc.invalidateQueries({ queryKey: ['forum', channelId] })
        qc.invalidateQueries({ queryKey: ['forum-post', d.post_id] })
      }
    })
    const offDelete = on('FORUM_POST_DELETE', (d: any) => {
      if (d.channel_id === channelId) {
        qc.invalidateQueries({ queryKey: ['forum', channelId] })
        if (selectedPost?.id === d.post_id) setSelectedPost(null)
      }
    })
    const offReply = on('FORUM_REPLY_CREATE', (d: any) => {
      if (d.channel_id === channelId) {
        qc.invalidateQueries({ queryKey: ['forum', channelId] })
        if (d.post_id) qc.invalidateQueries({ queryKey: ['forum-post', d.post_id] })
      }
    })
    return () => { offCreate(); offUpdate(); offDelete(); offReply() }
  }, [channelId, on, qc, selectedPost?.id])

  if (selectedPost) {
    return <PostView serverId={serverId} channelId={channelId} post={selectedPost} onBack={() => setSelectedPost(null)} />
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px]">
        <button
          className="md:hidden flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label="Retour aux canaux"
        >
          <ChevronLeft size={20} />
        </button>
        <MessagesSquare size={18} className="text-fc-muted flex-shrink-0" />
        <span className="font-semibold text-white">{channel.name}</span>
        {channel.topic && (
          <>
            <div className="w-px h-4 bg-fc-hover mx-1" />
            <span className="text-sm text-fc-muted truncate hidden md:block">{channel.topic}</span>
          </>
        )}
        <div className="ml-auto">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
          >
            <Plus size={15} /> Nouveau post
          </button>
        </div>
      </div>

      {/* Liste posts */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {posts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessagesSquare size={48} className="text-fc-muted opacity-30 mb-4" />
            <p className="text-fc-text font-semibold mb-1">Aucun post pour l'instant</p>
            <p className="text-fc-muted text-sm mb-4">Soyez le premier à poster dans ce forum !</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
            >
              Créer un post
            </button>
          </div>
        )}

        {posts.map((post) => (
          <button
            key={post.id}
            onClick={() => setSelectedPost(post)}
            className="w-full text-left bg-fc-hover/20 hover:bg-fc-hover/40 rounded-lg p-4 border border-fc-hover/30 hover:border-fc-hover transition group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0 overflow-hidden">
                {post.creator_avatar
                  ? <img src={post.creator_avatar} alt="" className="w-full h-full object-cover" />
                  : post.creator_username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {post.pinned && <Pin size={13} className="text-yellow-400 flex-shrink-0" />}
                  {post.locked && <Lock size={13} className="text-red-400 flex-shrink-0" />}
                  <h3 className="font-semibold text-white group-hover:text-fc-accent transition truncate">{post.title}</h3>
                </div>
                <div className="flex items-center gap-2 text-xs text-fc-muted mb-2">
                  <span>{post.creator_username}</span>
                  <span>·</span>
                  <span>{formatDate(post.created_at)}</span>
                  {post.last_reply_at && (
                    <>
                      <span>·</span>
                      <span>Dernière réponse {formatDate(post.last_reply_at)}</span>
                    </>
                  )}
                </div>
                {post.content && (
                  <p className="text-sm text-fc-muted line-clamp-2 mb-2">{post.content}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-fc-muted">
                  {post.tags.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Tag size={11} />
                      {post.tags.slice(0, 3).map(t => (
                        <span key={t} className="px-1.5 py-0.5 bg-fc-accent/15 text-fc-accent rounded-full">#{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
                    <MessageSquare size={11} />
                    <span>{post.reply_count} réponse{post.reply_count !== 1 ? 's' : ''}</span>
                  </div>
                  <ChevronRight size={14} className="text-fc-muted group-hover:text-white transition" />
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {showCreate && (
        <CreatePostModal serverId={serverId} channelId={channelId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
