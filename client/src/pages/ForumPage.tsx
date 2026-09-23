import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare, Plus, Tag, MessageSquare, ChevronRight, Pin, Lock, X, ArrowLeft, Trash2, Pencil, Check, ChevronLeft, Paperclip, Loader2, Search, Link2, SmilePlus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import api, { mediaUrl } from '../api/client'
import { useFormatDate } from '../hooks/useFormatDate'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import toast from 'react-hot-toast'
import { confirm } from '../components/ui/ConfirmModal'
import { useMobile } from '../contexts/MobileContext'
import { useMediaUpload } from '../components/chat/MediaContent'
import PostView, { AttachButton, type ForumPost } from '../components/forum/PostView'
import EmojiPicker from '../components/chat/EmojiPicker'
import LinkPreview, { extractFirstUrl } from '../components/chat/LinkPreview'
import { handleMarkdownShortcut } from '../utils/mdShortcuts'
import { useTypeToFocus } from '../hooks/useTypeToFocus'
import UserPopup from '../components/UserPopup'
import { isToday, isYesterday, format } from 'date-fns'
import { fr } from 'date-fns/locale'

const POST_PAGE = 50

interface Props {
  channel: { id: string; name: string; topic?: string }
  serverId: string
  channelId: string
  canManageMessages?: boolean
}

function CreatePostModal({ serverId, channelId, onClose }: { serverId: string; channelId: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const qc = useQueryClient()
  const postUpload = useMediaUpload(serverId, channelId)

  // Tags officiels définis par l'admin (ChannelSettingsModal) -- s'il y en a,
  // le backend n'accepte plus que ceux-là (cf. create_post) : on les propose
  // en suggestions cliquables au lieu de laisser un champ libre qui échouerait.
  const { data: officialTags = [] } = useQuery<string[]>({
    queryKey: ['forum-tags', channelId],
    queryFn: () => api.get(`/channels/${channelId}/tags`).then(r => r.data),
  })

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
              onKeyDown={e => {
                if (handleMarkdownShortcut(e, content, setContent)) return
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && title.trim() && !create.isPending) create.mutate()
              }}
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
            {officialTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {officialTags.map(t => (
                  <button
                    key={t}
                    type="button"
                    disabled={tags.includes(t) || tags.length >= 5}
                    onClick={() => setTags([...tags, t])}
                    className="px-2 py-1 rounded-full text-xs bg-fc-accent/15 text-fc-accent hover:bg-fc-accent/30 transition disabled:opacity-40"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            ) : (
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
            )}
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

export default function ForumPage({ channel, serverId, channelId, canManageMessages }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPost, setSelectedPostState] = useState<ForumPost | null>(null)
  const [urlParams, setUrlParams] = useSearchParams()
  const qc = useQueryClient()
  const { on } = useWs()
  const { openSidebar } = useMobile()
  const { formatShortDate, formatDate } = useFormatDate()

  // Posts par pages de 50 dans l'ordre du salon (épinglés d'abord) ; curseur = dernier post reçu
  const { data: postPages, isLoading: postsLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['forum', channelId],
    queryFn: ({ pageParam }) => api.get<ForumPost[]>(`/servers/${serverId}/channels/${channelId}/posts`, {
      params: { limit: POST_PAGE, ...(pageParam ? { before: pageParam } : {}) },
    }).then(r => r.data),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.length === POST_PAGE ? last[last.length - 1]?.id ?? null : null),
    enabled: !!channelId,
  })
  const allPosts = useMemo(() => postPages?.pages.flat() ?? [], [postPages])

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
    if (!urlPostId || selectedPost || postsLoading) return
    const found = allPosts.find(p => p.id === urlPostId)
    if (found) { setSelectedPostState(found); return }
    // Post hors de la page chargée : le demander directement
    api.get(`/servers/${serverId}/channels/${channelId}/posts/${urlPostId}`, { params: { limit: 1 } })
      .then(r => { if (r.data?.post) setSelectedPostState(r.data.post) })
      .catch(() => {})
  }, [urlPostId, allPosts.length, postsLoading])

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
    return <PostView serverId={serverId} channelId={channelId} post={selectedPost} onBack={() => setSelectedPost(null)} canManageMessages={canManageMessages} />
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
                  ? <img src={mediaUrl(post.creator_avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
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

        {hasNextPage && (
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="w-full py-2 text-sm text-fc-accent hover:underline disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Chargement…' : 'Afficher plus de posts'}
          </button>
        )}
      </div>

      {showCreate && (
        <CreatePostModal serverId={serverId} channelId={channelId} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
