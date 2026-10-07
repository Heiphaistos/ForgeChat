import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MessagesSquare, Images, Play, Plus, Tag, MessageSquare, ChevronRight, Pin, Lock, X, ArrowLeft, Trash2, Pencil, Check, ChevronLeft, Paperclip, Loader2, Search, Link2, SmilePlus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import api, { mediaUrl } from '../api/client'
import { useFormatDate } from '../hooks/useFormatDate'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import toast from 'react-hot-toast'
import { confirm } from '../components/ui/ConfirmModal'
import { useMobile } from '../contexts/MobileContext'
import { EncMedia, isEncUrl, useMediaUpload } from '../components/chat/MediaContent'
import { fileEntries } from '../e2e/crypto'
import PostView, { AttachButton, isVideoUrl, type ForumPost } from '../components/forum/PostView'
import EmojiPicker from '../components/chat/EmojiPicker'
import LinkPreview, { extractFirstUrl } from '../components/chat/LinkPreview'
import { handleMarkdownShortcut } from '../utils/mdShortcuts'
import { useTypeToFocus } from '../hooks/useTypeToFocus'
import { useT } from '../i18n'
import { channelSendError } from '../e2e/channels'
import { completeChannelKeys } from '../e2e/conversations'
import { openPost, openPosts, sealPost } from '../e2e/channelScopes'
import { ChannelLock } from '../e2e/ChannelBadge'
import UserPopup from '../components/UserPopup'
import { isToday, isYesterday, format } from 'date-fns'

const POST_PAGE = 50

interface Props {
  channel: { id: string; name: string; topic?: string }
  serverId: string
  channelId: string
  canManageMessages?: boolean
  /** Salon média : grille de vignettes, chaque publication exige une image ou une vidéo. */
  media?: boolean
}

function CreatePostModal({ serverId, channelId, media, onClose }: { serverId: string; channelId: string; media?: boolean; onClose: () => void }) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [mediaFile, setMediaFile] = useState<string | null>(null)
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
    // Salon chiffré : titre et contenu chiffrés ensemble (portée de la publication), tags et média en clair.
    mutationFn: () => sealPost(serverId, channelId, title.trim(), content.trim(), body =>
      api.post(`/servers/${serverId}/channels/${channelId}/posts`, {
        ...body,
        content: body.content ?? undefined,
        tags,
        ...(mediaFile ? { media_url: mediaFile } : {}),
      }), undefined, postUpload.filesFor(content, mediaFile)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forum', channelId] })
      toast.success(t('forum.created'))
      onClose()
    },
    onError: (e: any) => toast.error(channelSendError(e, e.response?.data?.error ?? t('common.error'))),
  })

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (tag && !tags.includes(tag) && tags.length < 5) {
      setTags([...tags, tag])
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
          <h2 id="create-post-title" className="text-xl font-bold text-white">{t('forum.newPost')}</h2>
          <button onClick={onClose} aria-label={t('common.close')} className="text-fc-muted hover:text-white transition"><X size={20} aria-hidden /></button>
        </div>
        <div className="p-6 space-y-4">
          {media && (
            <div>
              <span className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('forum.mediaLabel')}</span>
              {mediaFile ? (
                <div className="relative">
                  {isEncUrl(mediaFile)
                    ? <EncMedia url={mediaFile} files={postUpload.entries} className="w-full max-h-64 object-contain rounded bg-black" />
                    : isVideoUrl(mediaFile)
                    ? <video src={mediaUrl(mediaFile)} controls playsInline className="w-full max-h-64 rounded bg-black" />
                    : <img src={mediaUrl(mediaFile)} alt="" className="w-full max-h-64 object-contain rounded bg-black" />}
                  <button onClick={() => setMediaFile(null)} aria-label={t('forum.removeMedia')} className="absolute top-2 right-2 p-1 rounded-full bg-black/70 text-white hover:bg-black"><X size={14} aria-hidden /></button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => postUpload.pick(setMediaFile)}
                  onDrop={e => postUpload.onDrop(e, setMediaFile)}
                  onDragOver={postUpload.onDragOver}
                  disabled={postUpload.uploading}
                  className="w-full h-32 border-2 border-dashed border-fc-hover rounded flex flex-col items-center justify-center gap-1 text-fc-muted hover:text-white hover:border-fc-accent transition disabled:opacity-50"
                >
                  {postUpload.uploading ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Images size={20} aria-hidden />}
                  <span className="text-sm">{t('forum.pickMedia')}</span>
                </button>
              )}
            </div>
          )}
          <div>
            <label htmlFor="fp-title" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{media ? t('forum.captionLabel') : t('forum.titleLabel')}</label>
            <input
              id="fp-title"
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={media ? t('forum.captionPh') : t('forum.titlePh')}
              maxLength={200}
              enterKeyHint="next"
              autoCapitalize="sentences"
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
            />
          </div>
          <div>
            <label htmlFor="fp-content" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('forum.content')}</label>
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
              placeholder={t('forum.contentPh')}
              rows={5}
              className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm resize-none"
            />
            <div className="flex items-center gap-1 mt-1">
              <AttachButton uploading={postUpload.uploading} onClick={() => postUpload.pick(url => setContent(c => (c ? c + '\n' : '') + url))} />
              <span className="text-xs text-fc-muted">{t('forum.attachHint')}</span>
            </div>
          </div>
          <div>
            <label htmlFor="fp-tag" className="block text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">{t('forum.tags')}</label>
            {officialTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {officialTags.map(tg => (
                  <button
                    key={tg}
                    type="button"
                    disabled={tags.includes(tg) || tags.length >= 5}
                    onClick={() => setTags([...tags, tg])}
                    className="px-2 py-1 rounded-full text-xs bg-fc-accent/15 text-fc-accent hover:bg-fc-accent/30 transition disabled:opacity-40"
                  >
                    #{tg}
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
                  placeholder={t('forum.addTagPh')}
                  maxLength={20}
                  enterKeyHint="done"
                  autoCapitalize="none"
                  className="flex-1 px-3 py-2 bg-fc-input rounded text-white outline-none focus:ring-2 focus:ring-fc-accent text-sm"
                />
                <button onClick={addTag} aria-label={t('chset.addTag')} className="px-3 py-2 bg-fc-hover text-fc-muted hover:text-white rounded text-sm transition">
                  <Plus size={16} aria-hidden />
                </button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tg => (
                <span key={tg} className="flex items-center gap-1 text-xs px-2 py-1 bg-fc-accent/20 text-fc-accent rounded-full">
                  #{tg}
                  <button onClick={() => setTags(tags.filter(x => x !== tg))} aria-label={t('forum.removeTag', { tag: tg })} className="hover:text-white">
                    <X size={10} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 bg-fc-bg/50 rounded-b-lg flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-fc-muted hover:text-white transition text-sm">{t('common.cancel')}</button>
          <button
            onClick={() => title.trim() && (!media || mediaFile) && create.mutate()}
            disabled={!title.trim() || (media && !mediaFile) || create.isPending}
            className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition disabled:opacity-50"
          >
            {create.isPending ? t('forum.publishing') : t('forum.publish')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ForumPage({ channel, serverId, channelId, canManageMessages, media }: Props) {
  const t = useT()
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
    }).then(r => openPosts(channelId, r.data)),
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
      .then(async r => { if (r.data?.post) setSelectedPostState(await openPost(channelId, r.data.post as ForumPost)) })
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
    // Clés du salon reçues : publications en attente s'ouvrent.
    const offKeys = on('E2E_KEYS', (d: any) => {
      if (d.conv_kind === 'channel' && d.conv_id === channelId) qc.invalidateQueries({ queryKey: ['forum', channelId] })
    })
    return () => { offCreate(); offUpdate(); offDelete(); offReply(); offKeys() }
  }, [channelId, on, qc, selectedPost?.id])
  // Salon chiffré : clés distribuées aux membres arrivés depuis, et à la clé du serveur.
  useEffect(() => { void completeChannelKeys(channelId) }, [channelId])

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
          aria-label={t('forum.back')}
        >
          <ChevronLeft size={20} />
        </button>
        {media ? <Images size={18} className="text-fc-muted flex-shrink-0" /> : <MessagesSquare size={18} className="text-fc-muted flex-shrink-0" />}
        <span className="font-semibold text-white">{channel.name}</span>
        <ChannelLock channelId={channelId} />
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
            <Plus size={15} /> {media ? t('forum.publish') : t('forum.newPost')}
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
            placeholder={t('forum.searchPh')}
            aria-label={t('forum.search')}
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            className="bg-transparent text-sm text-white outline-none flex-1 min-w-0 placeholder-fc-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label={t('settings.clearSearch')} className="text-fc-muted hover:text-white transition"><X size={12} aria-hidden /></button>
          )}
        </div>
        {tagFilter && (
          <button
            onClick={() => setTagFilter(null)}
            className="flex items-center gap-1 px-2 py-1 bg-fc-accent/20 text-fc-accent rounded-full text-xs whitespace-nowrap hover:bg-fc-accent/30 transition"
            title={t('forum.removeFilter')}
          >
            #{tagFilter} <X size={10} aria-hidden />
          </button>
        )}
        <div className="flex rounded-lg overflow-hidden border border-fc-hover flex-shrink-0" role="group" aria-label={t('forum.sort')}>
          <button
            onClick={() => setSortBy('recent')}
            aria-pressed={sortBy === 'recent'}
            className={`px-2.5 py-1.5 text-xs font-medium transition ${sortBy === 'recent' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
          >
            {t('forum.recent')}
          </button>
          <button
            onClick={() => setSortBy('active')}
            aria-pressed={sortBy === 'active'}
            className={`px-2.5 py-1.5 text-xs font-medium transition ${sortBy === 'active' ? 'bg-fc-hover text-white' : 'text-fc-muted hover:text-white'}`}
          >
            {t('forum.active')}
          </button>
        </div>
      </div>

      {/* Liste posts */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3">
        {/* Skeleton au premier chargement (évite le faux « Aucun post ») */}
        {postsLoading && (
          <div role="status" aria-label={t('forum.loading')} className="space-y-3">
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
          <div className="text-center text-fc-muted py-16 text-sm">{t('forum.noMatch')}</div>
        )}
        {!postsLoading && allPosts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessagesSquare size={48} className="text-fc-muted opacity-30 mb-4" />
            <p className="text-fc-text font-semibold mb-1">{t('forum.none')}</p>
            <p className="text-fc-muted text-sm mb-4">{media ? t('forum.noneMedia') : t('forum.noneForum')}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-fc-accent hover:bg-indigo-500 text-white rounded text-sm font-medium transition"
            >
              {t('forum.createPost')}
            </button>
          </div>
        )}

        {media && posts.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {posts.map(post => (
              <button
                key={post.id}
                onClick={() => setSelectedPost(post)}
                aria-label={post.title}
                className="relative aspect-square rounded-lg overflow-hidden bg-fc-hover/30 group focus:outline-none focus:ring-2 focus:ring-fc-accent"
              >
                {post.media_url && isEncUrl(post.media_url)
                  ? <EncMedia url={post.media_url} files={fileEntries(post.e2e_body)} className="w-full h-full object-cover" />
                  : post.media_url && (isVideoUrl(post.media_url)
                  ? <>
                      <video src={mediaUrl(post.media_url)} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                      <Play size={28} className="absolute inset-0 m-auto text-white drop-shadow" aria-hidden />
                    </>
                  : <img src={mediaUrl(post.media_url)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition" />)}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent text-left">
                  <div className="text-xs text-white font-medium truncate">{post.title}</div>
                  <div className="text-[11px] text-white/70 flex items-center gap-1">
                    {post.pinned && <Pin size={10} aria-hidden />}
                    <MessageSquare size={10} aria-hidden /> {post.reply_count}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
        {!media && posts.map((post) => (
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
                      <span>{t('forum.lastReply', { date: formatDate(post.last_reply_at) })}</span>
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
                      {post.tags.slice(0, 3).map(tg => (
                        <span
                          key={tg}
                          onClick={e => { e.stopPropagation(); setTagFilter(cur => cur === tg ? null : tg) }}
                          title={t('forum.filterBy', { tag: tg })}
                          className={`px-1.5 py-0.5 rounded-full cursor-pointer transition ${tagFilter === tg ? 'bg-fc-accent text-white' : 'bg-fc-accent/15 text-fc-accent hover:bg-fc-accent/30'}`}
                        >#{tg}</span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 ml-auto">
                    <MessageSquare size={11} />
                    <span>{t(post.reply_count !== 1 ? 'forum.replies.other' : 'forum.replies.one', { n: post.reply_count })}</span>
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
            {isFetchingNextPage ? t('forum.loadingShort') : t('forum.more')}
          </button>
        )}
      </div>

      {showCreate && (
        <CreatePostModal serverId={serverId} channelId={channelId} media={media} onClose={() => setShowCreate(false)} />
      )}
    </div>
  )
}
