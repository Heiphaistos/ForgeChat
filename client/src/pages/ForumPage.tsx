import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare, Plus, Tag, MessageSquare, ChevronRight, Pin, Lock, X, ArrowLeft, Trash2, Pencil, Check, ChevronLeft, Paperclip, Loader2, Search, Link2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useFormatDate } from '../hooks/useFormatDate'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import toast from 'react-hot-toast'
import { confirm } from '../components/ui/ConfirmModal'
import { useMobile } from '../contexts/MobileContext'
import MediaContent, { useMediaUpload } from '../components/chat/MediaContent'
import { isToday, isYesterday, format } from 'date-fns'
import { fr } from 'date-fns/locale'

// Brouillons de réponse par post — module-level, survivent à la navigation
const forumDrafts = new Map<string, string>()

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

function AttachButton({ uploading, onClick }: { uploading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={uploading}
      title="Joindre une image ou vidéo"
      aria-label="Joindre une image ou vidéo"
      className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition disabled:opacity-50 flex-shrink-0"
    >
      {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Paperclip size={16} aria-hidden />}
    </button>
  )
}

function CreatePostModal({ serverId, channelId, onClose }: { serverId: string; channelId: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const qc = useQueryClient()
  const postUpload = useMediaUpload(serverId, channelId)

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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-post-title"
        className="bg-fc-channel rounded-lg w-full max-w-[560px] max-h-[90dvh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-fc-bg flex items-start justify-between">
          <h2 id="create-post-title" className="text-xl font-bold text-white">Nouveau post</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-fc-muted hover:text-white transition"><X size={20} aria-hidden /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label htmlFor="fp-title" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">Titre *</label>
            <input
              id="fp-title"
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Titre du post..."
              maxLength={200}
              enterKeyHint="next"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>
          <div>
            <label htmlFor="fp-content" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">Contenu</label>
            <textarea
              id="fp-content"
              value={content}
              onChange={e => setContent(e.target.value)}
              onPaste={e => postUpload.onPaste(e, url => setContent(c => (c ? c + '\n' : '') + url))}
              onDrop={e => postUpload.onDrop(e, url => setContent(c => (c ? c + '\n' : '') + url))}
              onDragOver={postUpload.onDragOver}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && title.trim() && !create.isPending) create.mutate() }}
              placeholder="Décrivez votre post... (Ctrl+Entrée pour publier)"
              rows={5}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
            />
            <div className="flex items-center gap-1 mt-1">
              <AttachButton uploading={postUpload.uploading} onClick={() => postUpload.pick(url => setContent(c => (c ? c + '\n' : '') + url))} />
              <span className="text-xs text-fc-muted">Image ou vidéo — insérée dans le contenu, affichée en direct</span>
            </div>
          </div>
          <div>
            <label htmlFor="fp-tag" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">Tags</label>
            <div className="flex gap-2 mb-2">
              <input
                id="fp-tag"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
                placeholder="Ajouter un tag..."
                maxLength={20}
                enterKeyHint="done"
                autoCapitalize="none"
                className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
              />
              <button onClick={addTag} aria-label="Ajouter le tag" className="px-3 py-2 bg-fc-hover text-fc-muted hover:text-white rounded text-sm transition">
                <Plus size={16} aria-hidden />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map(t => (
                <span key={t} className="flex items-center gap-1 text-xs px-2 py-1 bg-fc-accent/20 text-fc-accent rounded-full">
                  #{t}
                  <button onClick={() => setTags(tags.filter(x => x !== t))} aria-label={`Retirer le tag ${t}`} className="hover:text-white">
                    <X size={10} aria-hidden />
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
  const [reply, setReply] = useState(() => forumDrafts.get(post.id) ?? '')
  // Sauvegarder le brouillon en continu (purgé à l'envoi)
  useEffect(() => {
    if (reply.trim()) forumDrafts.set(post.id, reply)
    else forumDrafts.delete(post.id)
  }, [reply, post.id])
  const replyUpload = useMediaUpload(serverId, channelId)
  const [localPost, setLocalPost] = useState(post)
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)
  // Édition du contenu du post original (réservée au créateur, backend déjà prêt)
  const [editingPost, setEditingPost] = useState(false)
  const [editPostContent, setEditPostContent] = useState('')
  const [editContent, setEditContent] = useState('')
  const qc = useQueryClient()
  const { user } = useAuth()
  const { on } = useWs()
  const { formatShortDate, formatDate } = useFormatDate()

  const savePost = useMutation({
    mutationFn: () => api.patch(`/servers/${serverId}/channels/${channelId}/posts/${post.id}`, { content: editPostContent.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
      setEditingPost(false)
      toast.success('Post modifié')
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Impossible de modifier le post'),
  })

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
        <button onClick={onBack} aria-label="Retour" className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white transition rounded hover:bg-fc-hover">
          <ArrowLeft size={18} aria-hidden />
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
            onClick={() => {
              const url = `${window.location.origin}/servers/${serverId}/channels/${channelId}?post=${post.id}`
              // Partage natif sur mobile, copie presse-papier sinon
              if (navigator.share) {
                navigator.share({ title: post.title, url }).catch(() => {})
              } else {
                navigator.clipboard.writeText(url).then(() => toast.success('Lien du post copié')).catch(() => toast.error('Impossible de copier'))
              }
            }}
            className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded hover:bg-fc-hover transition"
            title="Partager le lien du post"
            aria-label="Partager le lien du post"
          >
            <Link2 size={15} aria-hidden />
          </button>
          <button
            onClick={() => togglePin.mutate()}
            title={localPost.pinned ? 'Désépingler' : 'Épingler'}
            className={`p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover transition ${localPost.pinned ? 'text-yellow-400' : 'text-fc-muted hover:text-yellow-400'}`}
          >
            <Pin size={15} />
          </button>
          <button
            onClick={() => toggleLock.mutate()}
            title={localPost.locked ? 'Déverrouiller' : 'Verrouiller'}
            className={`p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover transition ${localPost.locked ? 'text-red-400' : 'text-fc-muted hover:text-red-400'}`}
          >
            <Lock size={15} />
          </button>
          {user && post.creator_id === user.id && (
            <button
              onClick={async () => { if (await confirm({ message: 'Supprimer ce post et toutes ses réponses ?', danger: true, confirmLabel: 'Supprimer' })) deletePost.mutate() }}
              disabled={deletePost.isPending}
              title="Supprimer le post"
              className="p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-fc-hover transition text-fc-muted hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
        {/* Post original */}
        {data?.post?.content && (
          <div className="bg-fc-hover/30 rounded-lg p-4 border border-fc-hover group">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                {post.creator_avatar
                  ? <img src={post.creator_avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  : post.creator_username.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-white">{post.creator_username}</span>
              <span className="text-xs text-fc-muted">{formatShortDate(post.created_at)}</span>
              {user?.id === post.creator_id && !editingPost && (
                <button
                  onClick={() => { setEditPostContent(data.post.content ?? ''); setEditingPost(true) }}
                  className="ml-auto opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 text-fc-muted hover:text-white rounded transition"
                  title="Modifier le post"
                  aria-label="Modifier le post"
                >
                  <Pencil size={13} aria-hidden />
                </button>
              )}
            </div>
            {editingPost ? (
              <div className="space-y-2">
                <textarea
                  value={editPostContent}
                  onChange={e => setEditPostContent(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setEditingPost(false)
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && editPostContent.trim()) savePost.mutate()
                  }}
                  rows={5}
                  autoFocus
                  className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
                />
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => editPostContent.trim() && savePost.mutate()}
                    disabled={!editPostContent.trim() || savePost.isPending}
                    className="px-3 py-1.5 bg-fc-accent hover:bg-indigo-500 text-white rounded font-medium transition disabled:opacity-50"
                  >
                    {savePost.isPending ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                  <button onClick={() => setEditingPost(false)} className="px-3 py-1.5 text-fc-muted hover:text-white transition">Annuler</button>
                  <span className="text-fc-muted hidden md:inline">Échap pour annuler · Ctrl+Entrée pour enregistrer</span>
                </div>
              </div>
            ) : (
              <MediaContent text={data.post.content} className="text-fc-text text-sm leading-relaxed whitespace-pre-wrap" />
            )}
          </div>
        )}

        {/* Réponses */}
        {replies.map((r, ri) => {
          const prev = replies[ri - 1]
          const rDate = new Date(r.created_at)
          const showDateDiv = !prev || new Date(prev.created_at).toDateString() !== rDate.toDateString()
          const dateLabel = isToday(rDate) ? "Aujourd'hui"
            : isYesterday(rDate) ? 'Hier'
            : format(rDate, 'EEEE d MMMM yyyy', { locale: fr })
          return (
          <div key={r.id}>
          {showDateDiv && (
            <div className="flex items-center gap-3 my-3 select-none" role="separator" aria-label={dateLabel}>
              <div className="flex-1 h-px bg-fc-hover/70" />
              <span className="text-[11px] font-semibold text-fc-muted capitalize whitespace-nowrap px-2 py-0.5 rounded-full bg-fc-hover/50">
                {dateLabel}
              </span>
              <div className="flex-1 h-px bg-fc-hover/70" />
            </div>
          )}
          <div className="flex gap-3 group">
            <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0 overflow-hidden">
              {r.author?.avatar
                ? <img src={r.author.avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                : (r.author?.username ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-sm font-medium ${r.user_id === user?.id ? 'text-fc-accent' : 'text-white'}`}>
                  {r.author?.username ?? 'Utilisateur supprimé'}
                </span>
                <span className="text-xs text-fc-muted">{formatShortDate(r.created_at)}</span>
                {r.user_id === user?.id && editingReplyId !== r.id && (
                  <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center gap-1 ml-auto transition">
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
                <MediaContent text={r.content} />
              )}
            </div>
          </div>
          </div>
          )
        })}

        {replies.length === 0 && (
          <div className="text-center text-fc-muted py-8 text-sm">Aucune réponse. Soyez le premier !</div>
        )}
      </div>

      {/* Input réponse */}
      {!localPost.locked && (
        <div className="p-4 border-t border-fc-bg flex-shrink-0">
          <div className="flex gap-2 items-end">
            <AttachButton uploading={replyUpload.uploading} onClick={() => replyUpload.pick(url => setReply(c => (c ? c + '\n' : '') + url))} />
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              autoFocus={window.innerWidth >= 768}
              onPaste={e => replyUpload.onPaste(e, url => setReply(c => (c ? c + '\n' : '') + url))}
              onDrop={e => replyUpload.onDrop(e, url => setReply(c => (c ? c + '\n' : '') + url))}
              onDragOver={replyUpload.onDragOver}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (reply.trim()) sendReply.mutate()
                }
              }}
              placeholder="Écrire une réponse..."
              rows={2}
              enterKeyHint="send"
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
  const [selectedPost, setSelectedPostState] = useState<ForumPost | null>(null)
  const [urlParams, setUrlParams] = useSearchParams()
  const qc = useQueryClient()
  const { on } = useWs()
  const { openSidebar } = useMobile()
  const { formatShortDate, formatDate } = useFormatDate()

  const { data: allPosts = [], isLoading: postsLoading } = useQuery<ForumPost[]>({
    queryKey: ['forum', channelId],
    queryFn: () => api.get(`/servers/${serverId}/channels/${channelId}/posts`).then(r => r.data),
    enabled: !!channelId,
  })

  // Deep-link : ?post=<id> ouvre le post directement (lien partageable),
  // et l'ouverture/fermeture maintient l'URL à jour
  const setSelectedPost = (p: ForumPost | null) => {
    setSelectedPostState(p)
    setUrlParams(prev => {
      const next = new URLSearchParams(prev)
      if (p) next.set('post', p.id); else next.delete('post')
      return next
    }, { replace: true })
  }
  const urlPostId = urlParams.get('post')
  useEffect(() => {
    if (urlPostId && !selectedPost && allPosts.length > 0) {
      const found = allPosts.find(p => p.id === urlPostId)
      if (found) setSelectedPostState(found)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPostId, allPosts.length])

  // Recherche titre/contenu, filtre par tag (clic sur un tag) et tri —
  // les posts épinglés restent toujours en tête
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'recent' | 'active'>('recent')
  const posts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = allPosts.filter(p =>
      (!q || p.title.toLowerCase().includes(q) || (p.content ?? '').toLowerCase().includes(q)) &&
      (!tagFilter || p.tags.includes(tagFilter))
    )
    return [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sortBy === 'active') {
        const la = a.last_reply_at ?? a.created_at
        const lb = b.last_reply_at ?? b.created_at
        return lb.localeCompare(la)
      }
      return b.created_at.localeCompare(a.created_at)
    })
  }, [allPosts, search, tagFilter, sortBy])

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

  useEffect(() => {
    const prefix = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
    document.title = selectedPost
      ? `${prefix}${selectedPost.title} | ForgeChat`
      : `${prefix}#${channel.name} | ForgeChat`
    return () => {
      const p = document.title.match(/^\(\d+\)\s*/)?.[0] ?? ''
      document.title = `${p}ForgeChat`
    }
  }, [selectedPost?.title, channel.name])

  if (selectedPost) {
    return <PostView serverId={serverId} channelId={channelId} post={selectedPost} onBack={() => setSelectedPost(null)} />
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg shadow-sm flex-shrink-0 min-h-[48px]">
        <button
          className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
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

      {/* Barre recherche + tri */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-fc-bg flex-shrink-0">
        <div className="flex items-center gap-2 bg-fc-input rounded-lg px-2.5 py-1.5 flex-1 min-w-0">
          <Search size={14} className="text-fc-muted flex-shrink-0" aria-hidden />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setTagFilter(null); (e.target as HTMLInputElement).blur() } }}
            placeholder="Rechercher un post..."
            aria-label="Rechercher un post"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            className="bg-transparent text-sm text-white outline-none flex-1 min-w-0 placeholder-fc-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Effacer la recherche" className="text-fc-muted hover:text-white transition"><X size={12} aria-hidden /></button>
          )}
        </div>
        {tagFilter && (
          <button
            onClick={() => setTagFilter(null)}
            className="flex items-center gap-1 px-2 py-1 bg-fc-accent/20 text-fc-accent rounded-full text-xs whitespace-nowrap hover:bg-fc-accent/30 transition"
            title="Retirer le filtre"
          >
            #{tagFilter} <X size={10} aria-hidden />
          </button>
        )}
        <div className="flex rounded-lg overflow-hidden border border-fc-hover flex-shrink-0" role="group" aria-label="Trier les posts">
          <button
            onClick={() => setSortBy('recent')}
            aria-pressed={sortBy === 'recent'}
            className={`px-2.5 py-1.5 text-xs font-medium transition ${sortBy === 'recent' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
          >
            Récents
          </button>
          <button
            onClick={() => setSortBy('active')}
            aria-pressed={sortBy === 'active'}
            className={`px-2.5 py-1.5 text-xs font-medium transition ${sortBy === 'active' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
          >
            Actifs
          </button>
        </div>
      </div>

      {/* Liste posts */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3">
        {/* Skeleton au premier chargement (évite le faux « Aucun post ») */}
        {postsLoading && (
          <div role="status" aria-label="Chargement des posts" className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="bg-fc-hover/20 rounded-lg p-4 border border-fc-hover/30 animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-fc-hover/50 flex-shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3.5 bg-fc-hover/50 rounded w-1/3" />
                    <div className="h-2.5 bg-fc-hover/40 rounded w-1/4" />
                    <div className="h-2.5 bg-fc-hover/30 rounded w-2/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {posts.length === 0 && (search || tagFilter) && allPosts.length > 0 && (
          <div className="text-center text-fc-muted py-16 text-sm">Aucun post ne correspond à la recherche.</div>
        )}
        {!postsLoading && allPosts.length === 0 && (
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
                  ? <img src={post.creator_avatar} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
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
                        <span
                          key={t}
                          onClick={e => { e.stopPropagation(); setTagFilter(cur => cur === t ? null : t) }}
                          title={`Filtrer par #${t}`}
                          className={`px-1.5 py-0.5 rounded-full cursor-pointer transition ${tagFilter === t ? 'bg-fc-accent text-white' : 'bg-fc-accent/15 text-fc-accent hover:bg-fc-accent/30'}`}
                        >#{t}</span>
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
