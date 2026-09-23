// Vue d'un post de forum : contenu, réponses paginées (curseur), pièces jointes,
// réactions, édition/suppression. Extraite de ForumPage.tsx (fichier > 800 lignes).
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pin, Lock, X, ArrowLeft, Trash2, Pencil, Check, Paperclip, Loader2, Link2, SmilePlus } from 'lucide-react'
import api, { mediaUrl } from '../../api/client'
import { useFormatDate } from '../../hooks/useFormatDate'
import { useAuth } from '../../store/auth'
import { useWs } from '../../store/ws'
import toast from 'react-hot-toast'
import { confirm } from '../ui/ConfirmModal'
import MediaContent from '../chat/MediaContent'
import EmojiPicker from '../chat/EmojiPicker'
import LinkPreview, { extractFirstUrl } from '../chat/LinkPreview'
import { AttachmentList, PendingFiles, usePendingFiles, uploadPendingFiles, type SimpleAttachment } from '../chat/ThreadAttachments'
import { handleMarkdownShortcut } from '../../utils/mdShortcuts'
import { useTypeToFocus } from '../../hooks/useTypeToFocus'
import UserPopup from '../UserPopup'
import { isToday, isYesterday, format } from 'date-fns'
import { fr } from 'date-fns/locale'

const REPLY_PAGE = 50

// Brouillons de réponse par post — module-level, survivent à la navigation
const forumDrafts = new Map<string, string>()
export interface ForumPost {
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

export interface ForumReply {
  id: string
  user_id: string
  content: string
  created_at: string
  author: { id: string; username: string; avatar?: string; discriminator: string }
  reactions?: { emoji: string; count: number; me: boolean; users?: string[] }[]
  attachments?: SimpleAttachment[]
}

export function AttachButton({ uploading, onClick }: { uploading: boolean; onClick: () => void }) {
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
export default function PostView({ serverId, channelId, post, onBack, canManageMessages }: { serverId: string; channelId: string; post: ForumPost; onBack: () => void; canManageMessages?: boolean }) {
  const [reply, setReply] = useState(() => forumDrafts.get(post.id) ?? '')
  // Sauvegarder le brouillon en continu (purgé à l'envoi)
  useEffect(() => {
    if (reply.trim()) forumDrafts.set(post.id, reply)
    else forumDrafts.delete(post.id)
  }, [reply, post.id])
  const pending = usePendingFiles()
  // Paramètre utilisateur "aperçus de liens" (cache partagé avec MessageList)
  const { data: userSettings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 60_000,
  })
  const linkPreviewEnabled = (userSettings?.link_preview ?? true) as boolean
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

  // Post + réponses par pages de 50, des plus récentes aux plus anciennes
  // (curseur = id de la réponse la plus ancienne reçue)
  const { data: pages, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['forum-post', post.id],
    queryFn: ({ pageParam }) => api.get<{ post: any; replies: ForumReply[] }>(`/servers/${serverId}/channels/${channelId}/posts/${post.id}`, {
      params: { limit: REPLY_PAGE, ...(pageParam ? { before: pageParam } : {}) },
    }).then(r => r.data),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.replies.length === REPLY_PAGE ? last.replies[0]?.id ?? null : null),
  })
  const data = pages?.pages[0]

  // Charger les réponses précédentes en conservant la position de lecture
  const listRef = useRef<HTMLDivElement>(null)
  const prevScrollHeight = useRef<number | null>(null)
  const loadOlder = () => {
    if (!hasNextPage || isFetchingNextPage) return
    prevScrollHeight.current = listRef.current?.scrollHeight ?? null
    fetchNextPage()
  }

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
    const offReact = on('FORUM_REPLY_REACTION', (d: any) => {
      if (d.post_id !== post.id) return
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
    })
    const offAtt = on('FORUM_REPLY_ATTACHMENT_ADDED', (d: any) => {
      if (d.post_id !== post.id) return
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
    })
    return () => { offEdit(); offDelete(); offReact(); offAtt() }
  }, [post.id, on, qc])

  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  // Double-tap sur une réponse → réaction ❤️ (parité canaux/groupes/threads)
  const dblTapStart = useRef<{ x: number; y: number } | null>(null)
  const dblTapRef = useRef<{ msgId: string; time: number } | null>(null)
  // Fermer le clavier virtuel quand on scrolle verticalement la liste (mobile)
  const kbDismissRef = useRef<{ x: number; y: number } | null>(null)
  // Popup profil au clic sur un avatar (parité canaux/groupes/threads)
  const [userPopup, setUserPopup] = useState<{ userId: string; x: number; y: number } | null>(null)
  // Type-to-focus (desktop) : taper hors de tout champ focus le composer de réponse
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null)
  useTypeToFocus(replyTextareaRef)
  const toggleReplyReaction = useMutation({
    mutationFn: ({ replyId, emoji }: { replyId: string; emoji: string }) =>
      api.put(`/servers/${serverId}/channels/${channelId}/posts/${post.id}/replies/${replyId}/reactions/${encodeURIComponent(emoji)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forum-post', post.id] }),
    onError: () => toast.error('Impossible de réagir'),
  })

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
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
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

  const replies: ForumReply[] = pages ? [...pages.pages].reverse().flatMap(p => p.replies) : []
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && prevScrollHeight.current != null) {
      el.scrollTop += el.scrollHeight - prevScrollHeight.current
      prevScrollHeight.current = null
    }
  }, [replies.length])

  const sendReply = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/channels/${channelId}/posts/${post.id}/replies`, {
      content: reply.trim(),
      has_attachments: pending.files.length > 0,
    }),
    onSuccess: async (res) => {
      const files = pending.files
      const replyId: string | undefined = res.data?.reply?.id
      setReply('')
      pending.clear()
      qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
      toast.success('Réponse ajoutée !')
      if (replyId && files.length > 0) {
        await uploadPendingFiles(`/servers/${serverId}/channels/${channelId}/posts/${post.id}/replies/${replyId}/attachments`, files).catch(() => {})
        qc.invalidateQueries({ queryKey: ['forum-post', post.id] })
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  // Limite serveur : 4000 caractères — bloquer avant l'aller-retour réseau
  const canSend = !!reply.trim() || pending.files.length > 0
  const trySendReply = () => {
    if (!canSend || sendReply.isPending) return
    if (reply.trim().length > 4000) {
      toast.error(`Réponse trop longue : ${reply.trim().length}/4000 caractères`)
      return
    }
    sendReply.mutate()
  }

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
          {canManageMessages && (
            <>
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
            </>
          )}
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

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4"
        onTouchStart={e => { kbDismissRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchMove={e => {
          const s = kbDismissRef.current
          if (!s) return
          const dx = Math.abs(e.touches[0].clientX - s.x)
          const dy = Math.abs(e.touches[0].clientY - s.y)
          // Scroll vertical franc → fermer le clavier virtuel (mobile)
          if (dy > 24 && dy > dx * 1.5) {
            kbDismissRef.current = null
            const el = document.activeElement as HTMLElement | null
            if (el && el.tagName === 'TEXTAREA') el.blur()
          }
        }}
      >
        {/* Post original */}
        {data?.post?.content && (
          <div className="bg-fc-hover/30 rounded-lg p-4 border border-fc-hover group">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={e => { e.stopPropagation(); setUserPopup({ userId: post.creator_id, x: e.clientX, y: e.clientY }) }}
                aria-label={`Voir le profil de ${post.creator_username}`}
                className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white overflow-hidden hover:ring-2 hover:ring-fc-accent/60 transition cursor-pointer"
              >
                {post.creator_avatar
                  ? <img src={mediaUrl(post.creator_avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                  : post.creator_username.charAt(0).toUpperCase()}
              </button>
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
                    if (handleMarkdownShortcut(e, editPostContent, setEditPostContent)) return
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
              <>
                <MediaContent text={data.post.content} className="text-fc-text text-sm leading-relaxed" />
                {linkPreviewEnabled && (() => {
                  const url = extractFirstUrl(data.post.content)
                  return url ? <LinkPreview url={url} /> : null
                })()}
              </>
            )}
          </div>
        )}

        {/* Réponses */}
        {hasNextPage && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={loadOlder}
              disabled={isFetchingNextPage}
              className="text-xs text-fc-accent hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {isFetchingNextPage && <Loader2 size={12} className="animate-spin" aria-hidden />}
              Charger les réponses précédentes
            </button>
          </div>
        )}
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
          <div
            className="flex gap-3 group"
            onTouchStart={e => { dblTapStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
            onTouchEnd={e => {
              const s = dblTapStart.current
              dblTapStart.current = null
              if (!s) return
              const dx = Math.abs(e.changedTouches[0].clientX - s.x)
              const dy = Math.abs(e.changedTouches[0].clientY - s.y)
              if (dx > 10 || dy > 10) { dblTapRef.current = null; return }
              const now = Date.now()
              if (dblTapRef.current?.msgId === r.id && now - dblTapRef.current.time < 300) {
                dblTapRef.current = null
                if ('vibrate' in navigator) navigator.vibrate(15)
                toggleReplyReaction.mutate({ replyId: r.id, emoji: '❤️' })
              } else {
                dblTapRef.current = { msgId: r.id, time: now }
              }
            }}
          >
            <button
              onClick={e => { e.stopPropagation(); setUserPopup({ userId: r.user_id, x: e.clientX, y: e.clientY }) }}
              aria-label={`Voir le profil de ${r.author?.username ?? 'l\'auteur'}`}
              className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white flex-shrink-0 overflow-hidden hover:ring-2 hover:ring-fc-accent/60 transition cursor-pointer"
            >
              {r.author?.avatar
                ? <img src={mediaUrl(r.author.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                : (r.author?.username ?? '?').charAt(0).toUpperCase()}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-sm font-medium ${r.user_id === user?.id ? 'text-fc-accent' : 'text-white'}`}>
                  {r.author?.username ?? 'Utilisateur supprimé'}
                </span>
                <span className="text-xs text-fc-muted">{formatShortDate(r.created_at)}</span>
                {(r as any).edited_at && (
                  <span className="text-[9px] text-fc-muted/60" title="Réponse modifiée">(modifié)</span>
                )}
                {editingReplyId !== r.id && (
                  <button
                    onClick={() => setReactionPickerFor(cur => cur === r.id ? null : r.id)}
                    className={`opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded transition ${r.user_id === user?.id ? '' : 'ml-auto'} ${reactionPickerFor === r.id ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                    title="Réagir"
                    aria-label="Réagir à la réponse"
                  ><SmilePlus size={13} aria-hidden /></button>
                )}
                {r.user_id === user?.id && editingReplyId !== r.id && (
                  <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 flex items-center gap-1 transition">
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
                      if (handleMarkdownShortcut(e, editContent, setEditContent)) return
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
                <>
                  <MediaContent text={r.content} />
                  <AttachmentList attachments={r.attachments} />
                  {linkPreviewEnabled && (() => {
                    const url = extractFirstUrl(r.content)
                    return url ? <LinkPreview url={url} /> : null
                  })()}
                  {((r.reactions?.length ?? 0) > 0 || reactionPickerFor === r.id) && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5 relative">
                      {(r.reactions ?? []).map(rc => (
                        <button
                          key={rc.emoji}
                          onClick={() => toggleReplyReaction.mutate({ replyId: r.id, emoji: rc.emoji })}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition ${
                            rc.me ? 'bg-fc-accent/20 border-fc-accent/50 text-white' : 'bg-fc-hover/40 border-transparent text-fc-muted hover:border-fc-hover'
                          }`}
                          title={(rc.users ?? []).join(', ')}
                          aria-label={`${rc.emoji} ${rc.count} réaction${rc.count > 1 ? 's' : ''}${rc.users?.length ? ' — ' + rc.users.join(', ') : ''}`}
                          aria-pressed={rc.me}
                        >
                          <span aria-hidden>{rc.emoji}</span>
                          <span>{rc.count}</span>
                        </button>
                      ))}
                      {reactionPickerFor === r.id && (
                        <EmojiPicker
                          serverId={serverId}
                          onPick={emoji => toggleReplyReaction.mutate({ replyId: r.id, emoji })}
                          onClose={() => setReactionPickerFor(null)}
                        />
                      )}
                    </div>
                  )}
                </>
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
          <PendingFiles files={pending.files} onRemove={pending.remove} />
          <div className="flex gap-2 items-end">
            <button
              type="button"
              onClick={pending.pick}
              title="Joindre des fichiers"
              aria-label="Joindre des fichiers"
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-fc-muted hover:text-white rounded-lg hover:bg-fc-hover transition flex-shrink-0"
            >
              <Paperclip size={16} aria-hidden />
            </button>
            <textarea
              ref={replyTextareaRef}
              value={reply}
              onChange={e => setReply(e.target.value)}
              autoFocus={window.innerWidth >= 768}
              onPaste={pending.onPaste}
              onDrop={pending.onDrop}
              onDragOver={pending.onDragOver}
              onKeyDown={e => {
                if (handleMarkdownShortcut(e, reply, setReply)) return
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  trySendReply()
                }
              }}
              placeholder="Écrire une réponse..."
              rows={2}
              enterKeyHint="send"
              className="flex-1 px-3 py-2 bg-fc-input rounded-lg text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
            />
            <button
              onClick={trySendReply}
              disabled={!canSend || sendReply.isPending}
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

      {userPopup && (
        <UserPopup
          userId={userPopup.userId}
          anchorX={userPopup.x}
          anchorY={userPopup.y}
          onClose={() => setUserPopup(null)}
        />
      )}
    </div>
  )
}
