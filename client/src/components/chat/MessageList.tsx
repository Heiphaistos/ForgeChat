import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ChevronDown, Loader2, SmilePlus, Copy, Link, Share2, CornerUpLeft, MessagesSquare, Forward, Pin, Pencil, Trash2, Flag } from 'lucide-react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../store/auth'
import { useContextMenu } from '../ui/ContextMenu'
import { useChat } from '../../store/chat'
import { useUnread } from '../../store/unread'
import EmojiPicker, { getRecentEmojis } from './EmojiPicker'
import UserPopup from '../UserPopup'
import ReactionPopup from './ReactionPopup'
import EditHistoryModal from './EditHistoryModal'
import ForwardModal from './ForwardModal'
import ReportModal from './ReportModal'
import LightboxModal from './LightboxModal'
import { stripMarkdown } from '../../utils/mdShortcuts'
import api from '../../api/client'
import toast from 'react-hot-toast'
import MessageRow from './MessageRow'
import { QUICK_EMOJIS, DBLCLICK_EMOJIS } from './messageListShared'

interface Props {
  channelId: string
  serverId: string
  onDeleteMessage: (msgId: string) => void
  onEditMessage: (msgId: string, content: string) => void
  onOpenThread?: (msgId: string) => void
  onAddReaction?: (msgId: string, emoji: string) => void
  onPinMessage?: (msgId: string, pinned: boolean) => void
  onReply?: (msg: any) => void
  onLoadMore?: () => Promise<boolean>
  initialHighlightId?: string | null
  canManageMessages?: boolean
  loadError?: boolean
  onRetryLoad?: () => void
}

// Emojis rapides personnalisés : les récents d'abord, complétés par les défauts
const quickEmojisList = () => [...new Set([...getRecentEmojis(), ...QUICK_EMOJIS])].slice(0, 8)

const EMPTY_MESSAGES: any[] = []
const EMPTY_ARR: string[] = []

// Position de scroll mémorisée par canal (durée de vie de l'app, pas persistée)
// pour reprendre la lecture où on l'avait laissée en revenant dans un canal
const savedScrollPositions = new Map<string, number>()

interface PopupState { userId: string; x: number; y: number }
interface ReactionPopupState { messageId: string; emoji: string; x: number; y: number; users: { user_id: string; username: string; avatar?: string }[] }

export default function MessageList({
  channelId,
  serverId,
  onDeleteMessage,
  onEditMessage,
  onOpenThread,
  onAddReaction,
  onPinMessage,
  onReply,
  onLoadMore,
  initialHighlightId,
  canManageMessages = false,
  loadError = false,
  onRetryLoad,
}: Props) {
  const { user } = useAuth()
  const nav = useNavigate()
  const avatarCtxMenu = useContextMenu()
  const [searchParams] = useSearchParams()
  const targetMsgId = searchParams.get('msg')

  const { data: customEmojisList = [] } = useQuery<{ name: string; url: string }[]>({
    queryKey: ['custom_emojis', serverId],
    queryFn: () => api.get(`/servers/${serverId}/emojis`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const { data: userSettings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 300_000,
  })
  const linkPreviewEnabled = (userSettings?.link_preview ?? true) as boolean
  const groupingMs = ((userSettings?.message_grouping_minutes as number | undefined) ?? 5) * 60 * 1000
  const timeFormat = (userSettings?.time_format as string | undefined) ?? '24h'
  const dateFormat = (userSettings?.date_format as string | undefined) ?? 'DD/MM/YYYY'
  const showTimestamps = (userSettings?.show_timestamps as string | undefined) ?? 'hover'

  const formatTs = (dateStr: string) => {
    const d = new Date(dateStr)
    const timeFmt = timeFormat === '12h' ? 'hh:mm a' : 'HH:mm'
    if (isToday(d)) return `Aujourd'hui à ${format(d, timeFmt)}`
    if (isYesterday(d)) return `Hier à ${format(d, timeFmt)}`
    const dateFmt = dateFormat === 'MM/DD/YYYY' ? 'MM/dd/yyyy' : dateFormat === 'YYYY-MM-DD' ? 'yyyy-MM-dd' : 'dd/MM/yyyy'
    return format(d, `${dateFmt} ${timeFmt}`, { locale: fr })
  }
  const formatShortTs = (dateStr: string) => format(new Date(dateStr), timeFormat === '12h' ? 'hh:mm a' : 'HH:mm')

  const customEmojiMap = useMemo(() =>
    Object.fromEntries(customEmojisList.map(e => [e.name, e.url])),
    [customEmojisList]
  )
  const messages = useChat(s => s.messagesByChannel[channelId] ?? EMPTY_MESSAGES)
  const typing = useChat(s => s.typing[channelId])
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Timestamp d'entrée dans le canal = base pour le divider "Nouveaux messages"
  const channelOpenTime = useRef<number>(Date.now())
  // Non-lus au moment de l'ouverture (capturé AVANT le markRead de ChannelPage —
  // les effets des enfants s'exécutent avant ceux du parent) + ancre du premier non-lu
  const unreadAtOpen = useRef(0)
  const firstUnreadId = useRef<string | null>(null)
  useEffect(() => {
    channelOpenTime.current = Date.now()
    initialScrollDone.current = false
    unreadAtOpen.current = useUnread.getState().counts[channelId] ?? 0
    firstUnreadId.current = null
  }, [channelId])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [emojiPickerFor, setEmojiPickerFor] = useState<string | null>(null)
  // Picker complet ouvert depuis « Plus de réactions » du menu contextuel
  const [fullEmojiFor, setFullEmojiFor] = useState<string | null>(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [newMsgCount, setNewMsgCount] = useState(0)
  // Pastille de date flottante affichée pendant le scroll (style Telegram)
  const [floatingDate, setFloatingDate] = useState<string | null>(null)
  const floatingDateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (floatingDateTimer.current) clearTimeout(floatingDateTimer.current) }, [])
  const [loadingMore, setLoadingMore] = useState(false)
  // État vide affiché après 400ms pour éviter le flash au chargement initial
  const [showEmpty, setShowEmpty] = useState(false)
  useEffect(() => {
    if (messages.length > 0) { setShowEmpty(false); return }
    const t = setTimeout(() => setShowEmpty(true), 400)
    return () => clearTimeout(t)
  }, [messages.length])
  const loadingMoreRef = useRef(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const [editHistoryMsg, setEditHistoryMsg] = useState<{ id: string } | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const isAtBottom = useRef(true)
  const initialScrollDone = useRef(false)

  // Ancrer le divider "Nouveaux messages" sur le premier message non lu du
  // chargement initial (par id, pour rester stable malgré prepend/append)
  useEffect(() => {
    if (firstUnreadId.current || unreadAtOpen.current <= 0 || messages.length === 0) return
    const idx = Math.max(0, messages.length - unreadAtOpen.current)
    firstUnreadId.current = messages[idx]?.id ?? null
  }, [messages.length])

  // Scroll initial : vers le premier non-lu s'il y en a, sinon position mémorisée
  // (retour dans le canal), sinon scroll instantané au bas du canal
  useEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      const el = containerRef.current
      if (el) {
        const saved = savedScrollPositions.get(channelId)
        const anchorEl = firstUnreadId.current ? document.getElementById(`msg-${firstUnreadId.current}`) : null
        if (anchorEl && !initialHighlightId) {
          // Aller au divider "Nouveaux messages" (comportement Discord)
          anchorEl.scrollIntoView({ behavior: 'auto', block: 'center' })
          const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
          isAtBottom.current = fromBottom < 60
          setShowScrollBtn(fromBottom > 200)
        } else if (saved != null && !initialHighlightId && unreadAtOpen.current === 0) {
          el.scrollTop = saved
          isAtBottom.current = false
          setShowScrollBtn(true)
        } else {
          el.scrollTop = el.scrollHeight
        }
        initialScrollDone.current = true
      }
    }
  }, [messages.length])

  // Clavier virtuel mobile : quand le viewport rétrécit (clavier ouvert) et que
  // l'utilisateur était en bas, rester collé en bas pour ne pas masquer les derniers messages
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    let lastHeight = vv.height
    const onResize = () => {
      const shrunk = vv.height < lastHeight - 50
      lastHeight = vv.height
      if (shrunk && isAtBottom.current) {
        requestAnimationFrame(() => {
          const el = containerRef.current
          if (el) el.scrollTop = el.scrollHeight
        })
      }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!initialScrollDone.current) return
    if (isAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      setNewMsgCount(0)
    } else {
      setNewMsgCount(c => c + 1)
    }
  }, [messages.length])

  // Purge des messages éphémères expirés côté client toutes les 5s
  useEffect(() => {
    const deleteMessage = useChat.getState().deleteMessage
    const id = setInterval(() => {
      const msgs = useChat.getState().messagesByChannel[channelId] ?? []
      msgs.forEach(m => {
        if (m.expires_at && new Date(m.expires_at) <= new Date()) {
          deleteMessage(channelId, m.id)
        }
      })
    }, 5000)
    return () => clearInterval(id)
  }, [channelId])

  // Animation du compteur de réactions quand le compte change (mise à jour WebSocket)
  useEffect(() => {
    const newBumped: Record<string, boolean> = {}
    messages.forEach(msg => {
      (msg.reactions ?? []).forEach((r: any) => {
        const key = `${msg.id}:${r.emoji}`
        const prev = prevCountsRef.current[key] ?? r.count
        if (r.count !== prev) newBumped[key] = true
      })
    })
    // Mettre à jour la map de référence
    const nextCounts: Record<string, number> = {}
    messages.forEach(msg => {
      (msg.reactions ?? []).forEach((r: any) => {
        nextCounts[`${msg.id}:${r.emoji}`] = r.count
      })
    })
    prevCountsRef.current = nextCounts
    if (Object.keys(newBumped).length > 0) {
      setBumped(newBumped)
      const t = setTimeout(() => setBumped({}), 200)
      return () => clearTimeout(t)
    }
  }, [messages])

  useEffect(() => {
    if (!initialHighlightId || messages.length === 0) return
    const timer = setTimeout(() => jumpToMessage(initialHighlightId), 300)
    return () => clearTimeout(timer)
  }, [initialHighlightId, messages.length])

  useEffect(() => {
    if (!targetMsgId || messages.length === 0) return
    const timer = setTimeout(() => jumpToMessage(targetMsgId), 300)
    return () => clearTimeout(timer)
  }, [targetMsgId, messages.length])

  const handleScroll = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isAtBottom.current = fromBottom < 60
    setShowScrollBtn(fromBottom > 200)
    if (fromBottom < 60) setNewMsgCount(0)

    // Mémoriser la position de lecture (supprimée si on est revenu en bas)
    if (initialScrollDone.current) {
      if (fromBottom > 200) savedScrollPositions.set(channelId, el.scrollTop)
      else savedScrollPositions.delete(channelId)
    }

    // Pastille de date flottante : jour du dernier séparateur passé au-dessus
    // du haut du viewport, masquée peu après la fin du scroll
    if (initialScrollDone.current) {
      const topEdge = el.getBoundingClientRect().top + 8
      let label: string | null = null
      el.querySelectorAll<HTMLElement>('[data-date-label]').forEach(d => {
        if (d.getBoundingClientRect().top < topEdge) label = d.dataset.dateLabel ?? null
      })
      if (label) {
        setFloatingDate(label)
        if (floatingDateTimer.current) clearTimeout(floatingDateTimer.current)
        floatingDateTimer.current = setTimeout(() => setFloatingDate(null), 1200)
      }
    }

    // Load more quand on touche le haut (ref évite la closure stale)
    if (el.scrollTop < 80 && !loadingMoreRef.current && onLoadMore) {
      loadingMoreRef.current = true
      setLoadingMore(true)
      const prevHeight = el.scrollHeight
      const hasMore = await onLoadMore()
      loadingMoreRef.current = false
      setLoadingMore(false)
      if (hasMore) {
        // Maintenir la position de scroll après chargement
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevHeight
        })
      }
    }
  }, [onLoadMore, channelId])

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Home/End (hors champ de saisie) : haut de l'historique chargé / bas du canal
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key === 'End') {
        e.preventDefault()
        scrollToBottom()
        setNewMsgCount(0)
      } else if (e.key === 'Home') {
        e.preventDefault()
        containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (e.key === 'PageUp' || e.key === 'PageDown') {
        const el = containerRef.current
        if (!el) return
        e.preventDefault()
        const delta = (el.clientHeight - 60) * (e.key === 'PageUp' ? -1 : 1)
        el.scrollBy({ top: delta, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const jumpToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`msg-${msgId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightId(msgId)
      setTimeout(() => setHighlightId(null), 2000)
    }
  }, [])

  const startEdit = useCallback((msgId: string) => {
    setEditingId(msgId)
    setEmojiPickerFor(null)
  }, [])

  // Le brouillon d'édition vit désormais dans MessageRow (état local) — le parent ne
  // reçoit que le texte final à la confirmation, ce qui évite de re-render toute la
  // liste à chaque frappe (avant : editContent était un état partagé ici).
  const confirmEdit = useCallback((msgId: string, newContent: string, originalContent: string) => {
    if (newContent !== originalContent) onEditMessage(msgId, newContent)
    setEditingId(null)
  }, [onEditMessage])

  const cancelEdit = useCallback(() => setEditingId(null), [])

  const openUserPopup = useCallback((e: React.MouseEvent, userId: string) => {
    e.stopPropagation()
    setPopup({ userId, x: e.clientX + 12, y: e.clientY - 40 })
  }, [])

  const [reactionPopup, setReactionPopup] = useState<ReactionPopupState | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [poppingReaction, setPoppingReaction] = useState<string | null>(null)
  const [bumped, setBumped] = useState<Record<string, boolean>>({})
  const prevCountsRef = useRef<Record<string, number>>({})
  const [forwardingMsg, setForwardingMsg] = useState<{ id: string } | null>(null)
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  const [dblClickPopover, setDblClickPopover] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [reminderFor, setReminderFor] = useState<string | null>(null)
  const [reportingMsg, setReportingMsg] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, string>>({})
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const density = useMemo(() => localStorage.getItem('fc_density') ?? 'normal', [])
  const compact = density === 'compact' || density === 'ultra-compact'
  const ultraCompact = density === 'ultra-compact'
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; msg: any } | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTarget = useRef<{ x: number; y: number; msg: any } | null>(null)
  const swipeRef = useRef<{ startX: number; startY: number; msg: any; el: HTMLElement | null } | null>(null)
  const lastTapRef = useRef<{ time: number; msgId: string } | null>(null)
  // Fermer le clavier virtuel quand on scrolle verticalement la liste (mobile)
  const kbDismissRef = useRef<{ x: number; y: number } | null>(null)

  // Cleanup à l'unmount
  useEffect(() => () => { if (longPressTimer.current) clearTimeout(longPressTimer.current) }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => { document.removeEventListener('click', close); document.removeEventListener('contextmenu', close) }
  }, [!!contextMenu])

  // En DM (serverId vide), channelId est l'id de conversation : autres routes
  // API (PUT toggle au lieu de DELETE) et autres URLs de lien
  const messageLink = useCallback((msgId: string) =>
    serverId
      ? `${window.location.origin}/servers/${serverId}/channels/${channelId}?highlight=${msgId}`
      : `${window.location.origin}/dms/${channelId}?highlight=${msgId}`,
  [serverId, channelId])

  const removeReactionMut = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: string; emoji: string }) =>
      serverId
        ? api.delete(`/servers/${serverId}/channels/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`)
        : api.put(`/dms/${channelId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`),
    onError: () => toast.error('Impossible de retirer la réaction'),
  })

  // Lit l'état frais via useChat.getState() plutôt que de fermer sur `messages` —
  // garde ce callback stable (seule dépendance réelle : channelId) pour React.memo(MessageRow)
  const toggleReaction = useCallback((msgId: string, emoji: string) => {
    const msgs = useChat.getState().messagesByChannel[channelId] ?? []
    const msg = msgs.find(m => m.id === msgId)
    const reaction = msg?.reactions?.find(r => r.emoji === emoji)
    if (reaction?.me) {
      removeReactionMut.mutate({ msgId, emoji })
    } else {
      onAddReaction?.(msgId, emoji)
    }
    setPoppingReaction(`${msgId}:${emoji}`)
    setTimeout(() => setPoppingReaction(null), 300)
  }, [channelId, onAddReaction])

  const startLongPress = useCallback((e: React.TouchEvent, msg: any) => {
    const t = e.touches[0]
    longPressTarget.current = { x: t.clientX, y: t.clientY, msg }
    longPressTimer.current = setTimeout(() => {
      if (longPressTarget.current) {
        if ('vibrate' in navigator) navigator.vibrate(20)
        setContextMenu(longPressTarget.current)
      }
    }, 500)
    swipeRef.current = { startX: t.clientX, startY: t.clientY, msg, el: e.currentTarget as HTMLElement }
  }, [])
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
    longPressTarget.current = null
  }, [])
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    cancelLongPress()
    if (!swipeRef.current || e.touches.length !== 1 || !swipeRef.current.el) return
    const dx = e.touches[0].clientX - swipeRef.current.startX
    const dy = e.touches[0].clientY - swipeRef.current.startY
    if (dx > 10 && Math.abs(dy) < Math.abs(dx) * 1.5) {
      swipeRef.current.el.style.transform = `translateX(${Math.min(dx * 0.45, 56)}px)`
      swipeRef.current.el.style.transition = 'none'
    } else {
      swipeRef.current.el.style.transform = ''
    }
  }, [cancelLongPress])
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    cancelLongPress()
    if (!swipeRef.current) return
    const dx = e.changedTouches[0].clientX - swipeRef.current.startX
    const dy = e.changedTouches[0].clientY - swipeRef.current.startY
    const { msg, el } = swipeRef.current
    swipeRef.current = null
    if (el) {
      el.style.transform = ''
      el.style.transition = 'transform 0.2s ease'
      setTimeout(() => { if (el) el.style.transition = '' }, 220)
    }
    if (onReply && dx > 60 && Math.abs(dy) < 80) {
      if ('vibrate' in navigator) navigator.vibrate(30)
      onReply(msg)
      return
    }
    // Double-tap → réaction rapide ❤️ (tap immobile, 2e tap sur le même message en <300ms)
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = Date.now()
      const last = lastTapRef.current
      if (last && last.msgId === msg.id && now - last.time < 300) {
        lastTapRef.current = null
        if ('vibrate' in navigator) navigator.vibrate(15)
        toggleReaction(msg.id, '❤️')
      } else {
        lastTapRef.current = { time: now, msgId: msg.id }
      }
    } else {
      lastTapRef.current = null
    }
  }, [cancelLongPress, onReply, toggleReaction])

  const saveMessage = useMutation({
    // server_id: null en DM — le backend attend Option<Uuid>, "" échoue en 422
    mutationFn: ({ message_id, channel_id, server_id }: { message_id: string; channel_id: string; server_id: string | null }) =>
      api.post('/saved', { message_id, channel_id, server_id }),
    onSuccess: () => toast.success('Message sauvegardé'),
    onError: () => toast.error('Erreur lors de la sauvegarde'),
  })

  const reactionHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchReactionUsers = useCallback(async (messageId: string, emoji: string, x: number, y: number) => {
    try {
      const res = await api.get(`/reactions?message_id=${messageId}&emoji=${encodeURIComponent(emoji)}`)
      const users = res.data?.users ?? []
      setReactionPopup({ messageId, emoji, x, y, users })
    } catch {}
  }, [])
  const handleReactionHover = useCallback((e: React.MouseEvent, messageId: string, emoji: string) => {
    const { clientX, clientY } = e
    if (reactionHoverTimer.current) clearTimeout(reactionHoverTimer.current)
    reactionHoverTimer.current = setTimeout(() => fetchReactionUsers(messageId, emoji, clientX, clientY), 300)
  }, [fetchReactionUsers])
  const handleReactionHoverEnd = useCallback(() => setReactionPopup(null), [])

  // Long-press mobile sur une réaction → popup "qui a réagi" (hover indisponible)
  const reactionLongPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reactionLongPressFired = useRef(false)
  const startReactionLongPress = useCallback((e: React.TouchEvent, messageId: string, emoji: string) => {
    const { clientX, clientY } = e.touches[0]
    reactionLongPressFired.current = false
    reactionLongPress.current = setTimeout(() => {
      reactionLongPressFired.current = true
      if ('vibrate' in navigator) navigator.vibrate(15)
      fetchReactionUsers(messageId, emoji, clientX, clientY)
    }, 450)
  }, [fetchReactionUsers])
  const cancelReactionLongPress = useCallback(() => {
    if (reactionLongPress.current) { clearTimeout(reactionLongPress.current); reactionLongPress.current = null }
  }, [])
  // Clic sur une pastille de réaction existante : suppression après un long-press
  // mobile (qui vient juste d'ouvrir le popup "qui a réagi") — ne concerne QUE ce
  // point d'entrée, pas le double-tap ❤️ ni les pickers d'ajout.
  const handleReactionClick = useCallback((msgId: string, emoji: string) => {
    if (reactionLongPressFired.current) { reactionLongPressFired.current = false; return }
    toggleReaction(msgId, emoji)
  }, [toggleReaction])

  // Lu via ref (pas de dépendance sur translatingId) pour que translateMessage — et donc
  // handleToggleTranslation qui l'appelle — restent des références stables entre renders.
  const translatingIdRef = useRef<string | null>(null)
  useEffect(() => { translatingIdRef.current = translatingId }, [translatingId])
  const translateMessage = useCallback(async (messageId: string) => {
    if (translatingIdRef.current === messageId) return
    setTranslatingId(messageId)
    try {
      const { data } = await api.post(`/messages/${messageId}/translate`, { target_lang: 'fr' })
      setTranslations(prev => ({ ...prev, [messageId]: data.translated }))
    } catch {
      toast.error('Traduction indisponible')
    } finally {
      setTranslatingId(null)
    }
  }, [])
  // Bouton traduction : masquer si déjà traduit, sinon lancer la traduction — lu via
  // ref pour garder ce handler stable (pas de dépendance sur `translations`)
  const translationsRef = useRef<Record<string, string>>({})
  useEffect(() => { translationsRef.current = translations }, [translations])
  const handleToggleTranslation = useCallback((msgId: string) => {
    if (translationsRef.current[msgId]) {
      setTranslations(prev => { const n = { ...prev }; delete n[msgId]; return n })
    } else {
      translateMessage(msgId)
    }
  }, [translateMessage])

  // -- Handlers stables passés à MessageRow (React.memo) — fonctionnels/sans état
  // fermé pour ne jamais changer de référence et casser la mémoïsation par ligne --
  const handleAvatarContextMenu = useCallback((e: React.MouseEvent, msg: any) => {
    e.preventDefault()
    e.stopPropagation()
    avatarCtxMenu.open(e, [
      { label: 'Voir le profil', onClick: () => nav(`/users/${msg.author_id}`) },
      { label: 'Envoyer un message', onClick: () => {
        api.post('/dms', { user_id: msg.author_id }).then(r => nav(`/dms/${r.data.id}`)).catch(() => {})
      }, disabled: msg.author_id === user?.id },
      { label: `Mentionner @${msg.author_username}`, onClick: () => {
        const el = document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')
        if (el) {
          const pos = el.selectionStart ?? el.value.length
          const mention = `@${msg.author_username} `
          const newVal = el.value.slice(0, pos) + mention + el.value.slice(pos)
          el.focus()
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
          setter?.call(el, newVal)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          const newPos = pos + mention.length
          setTimeout(() => el.setSelectionRange(newPos, newPos), 0)
        }
      }},
      { separator: true },
      { label: 'Copier l\'ID', onClick: () => navigator.clipboard.writeText(msg.author_id) },
    ])
  }, [nav, user?.id])

  const handleRowDoubleClick = useCallback((msgId: string, x: number, y: number) => setDblClickPopover({ msgId, x, y }), [])
  const handleRowContextMenu = useCallback((x: number, y: number, msg: any) => setContextMenu({ x, y, msg }), [])
  const handleOpenEditHistory = useCallback((msgId: string) => setEditHistoryMsg({ id: msgId }), [])
  const handleOpenLightbox = useCallback((images: string[], index: number) => setLightbox({ images, index }), [])
  const handleToggleEmojiPicker = useCallback((msgId: string) => setEmojiPickerFor(cur => cur === msgId ? null : msgId), [])
  const handleToggleReactionPicker = useCallback((msgId: string) => setReactionPickerFor(cur => cur === msgId ? null : msgId), [])
  const handleToggleReminder = useCallback((msgId: string) => setReminderFor(cur => cur === msgId ? null : msgId), [])
  const handleAddQuickReaction = useCallback((msgId: string, emoji: string) => {
    onAddReaction?.(msgId, emoji)
    setEmojiPickerFor(null)
  }, [onAddReaction])
  const handlePickReaction = useCallback((msgId: string, emoji: string) => {
    toggleReaction(msgId, emoji)
    setReactionPickerFor(null)
  }, [toggleReaction])
  const handleSaveMessage = useCallback((msgId: string) =>
    saveMessage.mutate({ message_id: msgId, channel_id: channelId, server_id: serverId || null }),
  [saveMessage, channelId, serverId])
  const handleCopyMarkdown = useCallback((content: string) => {
    navigator.clipboard.writeText(content)
    toast.success('Copié en Markdown !')
  }, [])
  const handleCopyLink = useCallback((msgId: string) => {
    navigator.clipboard.writeText(messageLink(msgId))
    toast.success('Lien copié !')
  }, [messageLink])
  const handleForward = useCallback((msgId: string) => setForwardingMsg({ id: msgId }), [])
  const handleReport = useCallback((msgId: string) => setReportingMsg(msgId), [])
  const handleDeleteRequest = useCallback((msgId: string) => setDeleteConfirmId(msgId), [])

  const formatTsCb = useCallback((dateStr: string) => formatTs(dateStr), [timeFormat, dateFormat])
  const formatShortTsCb = useCallback((dateStr: string) => formatShortTs(dateStr), [timeFormat])
  // Recalculé seulement après une utilisation du picker complet (seul endroit qui peut
  // faire évoluer les "récents") — reste une référence stable pour tous les autres renders
  const quickEmojisArr = useMemo(() => quickEmojisList(), [fullEmojiFor])

  return (
    <div className="flex-1 relative flex flex-col overflow-hidden channel-fade-in">
      <div
        ref={containerRef}
        role="log"
        aria-label="Historique des messages"
        aria-live="polite"
        aria-busy={loadingMore}
        className="flex-1 overflow-y-auto overscroll-contain px-2 md:px-4 py-2 space-y-0.5 message-list-container"
        onClick={() => { setEmojiPickerFor(null); setPopup(null); setReactionPickerFor(null); setDblClickPopover(null) }}
        onScroll={handleScroll}
        onTouchStart={e => { kbDismissRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }}
        onTouchMove={e => {
          const s = kbDismissRef.current
          if (!s) return
          const dx = Math.abs(e.touches[0].clientX - s.x)
          const dy = Math.abs(e.touches[0].clientY - s.y)
          // Scroll vertical franc (pas un swipe-reply horizontal) → blur du composer
          if (dy > 24 && dy > dx * 1.5) {
            kbDismissRef.current = null
            const el = document.activeElement as HTMLElement | null
            if (el && el.tagName === 'TEXTAREA') el.blur()
          }
        }}
      >
        {/* Loader "plus de messages" */}
        {loadingMore && (
          <div className="flex justify-center py-3" role="status" aria-label="Chargement des messages précédents">
            <Loader2 size={18} className="animate-spin text-fc-muted" aria-hidden />
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = messages[i - 1]
          const isGrouped =
            prev &&
            prev.author_id === msg.author_id &&
            new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < groupingMs

          const msgTs = new Date(msg.created_at).getTime()
          const prevTs = prev ? new Date(prev.created_at).getTime() : 0
          // Divider : ancré sur le premier non-lu du chargement initial si présent,
          // sinon sur le premier message arrivé après l'ouverture (live)
          const isFirstUnread = firstUnreadId.current
            ? msg.id === firstUnreadId.current
            : msgTs >= channelOpenTime.current && prevTs < channelOpenTime.current
          // Animer uniquement les messages qui arrivent en temps réel (après le chargement initial)
          const isLiveMsg = initialScrollDone.current && msgTs >= channelOpenTime.current
          // Séparateur de date entre deux jours différents
          const msgDate = new Date(msg.created_at)
          const prevDateStr = prev ? new Date(prev.created_at).toDateString() : null
          const showDateDivider = prevDateStr !== msgDate.toDateString()
          const dateLabel = isToday(msgDate) ? "Aujourd'hui"
            : isYesterday(msgDate) ? 'Hier'
            : format(msgDate, 'EEEE d MMMM yyyy', { locale: fr })

          // Props scindées par message : dérivées ici d'un état partagé ("quel message
          // a X ouvert") en valeurs primitives par ligne, pour que React.memo(MessageRow)
          // ne re-rende QUE la ligne concernée plutôt que toute la liste à chaque toggle.
          const isPoppingHere = poppingReaction?.startsWith(msg.id + ':') ?? false
          const poppingEmoji = isPoppingHere ? poppingReaction!.slice(msg.id.length + 1) : null
          const bumpedEmojis = Object.keys(bumped).length === 0
            ? EMPTY_ARR
            : Object.keys(bumped).filter(k => k.startsWith(msg.id + ':')).map(k => k.slice(msg.id.length + 1))

          return (
            <MessageRow
              key={msg.id}
              msg={msg}
              isOwn={msg.author_id === user?.id}
              isGrouped={!!isGrouped}
              isFirstUnread={isFirstUnread}
              isLiveMsg={isLiveMsg}
              showDateDivider={showDateDivider}
              dateLabel={dateLabel}
              isHighlighted={highlightId === msg.id}
              isEditing={editingId === msg.id}
              compact={compact}
              ultraCompact={ultraCompact}
              showTimestamps={showTimestamps}
              formatTs={formatTsCb}
              formatShortTs={formatShortTsCb}
              customEmojiMap={customEmojiMap}
              linkPreviewEnabled={linkPreviewEnabled}
              serverId={serverId}
              channelId={channelId}
              canManageMessages={canManageMessages}
              quickEmojis={quickEmojisArr}
              showEmojiPicker={emojiPickerFor === msg.id}
              showReactionPicker={reactionPickerFor === msg.id}
              isReminderOpen={reminderFor === msg.id}
              translation={translations[msg.id]}
              isTranslating={translatingId === msg.id}
              poppingEmoji={poppingEmoji}
              bumpedEmojis={bumpedEmojis}
              onStartEdit={startEdit}
              onConfirmEdit={confirmEdit}
              onCancelEdit={cancelEdit}
              onOpenUserPopup={openUserPopup}
              onAvatarContextMenu={handleAvatarContextMenu}
              onDoubleClick={handleRowDoubleClick}
              onContextMenu={handleRowContextMenu}
              onTouchStartRow={startLongPress}
              onTouchMoveRow={handleTouchMove}
              onTouchEndRow={handleTouchEnd}
              onJumpToMessage={jumpToMessage}
              onOpenEditHistory={handleOpenEditHistory}
              onOpenLightbox={handleOpenLightbox}
              onToggleReaction={handleReactionClick}
              onToggleEmojiPicker={handleToggleEmojiPicker}
              onAddQuickReaction={handleAddQuickReaction}
              onPickReaction={handlePickReaction}
              onToggleReactionPicker={handleToggleReactionPicker}
              onReactionHover={handleReactionHover}
              onReactionHoverEnd={handleReactionHoverEnd}
              onReactionTouchStart={startReactionLongPress}
              onReactionTouchEnd={cancelReactionLongPress}
              onSaveMessage={handleSaveMessage}
              onCopyMarkdown={handleCopyMarkdown}
              onCopyLink={handleCopyLink}
              onForward={handleForward}
              onReply={onReply}
              onOpenThread={onOpenThread}
              onPinMessage={onPinMessage}
              onToggleTranslation={handleToggleTranslation}
              onToggleReminder={handleToggleReminder}
              onReport={handleReport}
              onDeleteRequest={handleDeleteRequest}
            />
          )
        })}

        {/* Indicateur de frappe */}
        {typing && Object.keys(typing).length > 0 && (() => {
          const names = Object.values(typing)
          const label = names.length === 1
            ? `${names[0]} est en train d'écrire...`
            : `${names.slice(0, 2).join(', ')} sont en train d'écrire...`
          return (
            <div className="text-xs text-fc-muted px-2 py-1 flex items-center gap-1.5 h-6">
              <div className="flex gap-0.5 items-center">
                {[0, 150, 300].map(delay => (
                  <span key={delay} className="w-1.5 h-1.5 bg-fc-muted rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                ))}
              </div>
              <span>{label}</span>
            </div>
          )
        })()}

        {/* Échec du chargement : erreur honnête + retry (au lieu du faux "Aucun message") */}
        {loadError && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-16 gap-3 select-none" role="alert">
            <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center text-3xl" aria-hidden>
              ⚠️
            </div>
            <p className="text-base font-semibold text-white">Impossible de charger les messages</p>
            <p className="text-sm text-fc-muted">Problème réseau ou serveur.</p>
            {onRetryLoad && (
              <button
                onClick={onRetryLoad}
                className="mt-1 px-4 py-2 min-h-[44px] bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition"
              >
                Réessayer
              </button>
            )}
          </div>
        )}

        {/* Skeleton pendant le chargement initial (avant que showEmpty ne s'affiche) */}
        {!loadError && messages.length === 0 && !showEmpty && !loadingMore && (
          <div className="px-4 py-6 space-y-5 animate-pulse motion-reduce:animate-none" aria-hidden>
            {[72, 45, 88, 60, 78].map((w, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-fc-hover flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 rounded bg-fc-hover" style={{ width: `${25 + (i % 3) * 8}%` }} />
                  <div className="h-3 rounded bg-fc-hover/60" style={{ width: `${w}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* État vide : canal sans messages */}
        {!loadError && showEmpty && !loadingMore && (
          <div className="flex flex-col items-center justify-center h-full py-16 gap-3 select-none" aria-label="Aucun message">
            <div className="w-16 h-16 rounded-2xl bg-fc-accent/20 flex items-center justify-center text-3xl" aria-hidden>
              💬
            </div>
            <p className="text-base font-semibold text-white">Aucun message ici… pour l'instant.</p>
            <p className="text-sm text-fc-muted">Soyez le premier à envoyer un message !</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Pastille de date flottante pendant le scroll */}
      {floatingDate && (
        <div
          aria-hidden
          className="floating-date-pill absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none px-3 py-1 rounded-full bg-fc-channel/90 border border-fc-hover shadow-lg text-[11px] font-semibold text-fc-text capitalize whitespace-nowrap backdrop-blur-sm"
        >
          {floatingDate}
        </div>
      )}

      {/* Bouton scroll to bottom */}
      {showScrollBtn && (
        <button
          onClick={() => { scrollToBottom(); setNewMsgCount(0) }}
          aria-label={newMsgCount > 0 ? `Aller en bas — ${newMsgCount} nouveau${newMsgCount > 1 ? 'x' : ''} message${newMsgCount > 1 ? 's' : ''}` : 'Aller en bas'}
          className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] bg-fc-accent hover:bg-indigo-500 text-white text-xs font-medium rounded-full shadow-lg transition"
        >
          {newMsgCount > 0 && (
            <span aria-hidden className="bg-white text-fc-accent font-bold rounded-full px-1.5 text-[10px] leading-4 min-w-[18px] text-center">
              {newMsgCount > 99 ? '99+' : newMsgCount}
            </span>
          )}
          <ChevronDown size={14} aria-hidden />
          Aller en bas
        </button>
      )}

      {/* Annonce discrète des nouveaux messages pour les lecteurs d'écran */}
      <div aria-live="polite" className="sr-only">
        {newMsgCount > 0 ? `${newMsgCount} nouveau${newMsgCount > 1 ? 'x' : ''} message${newMsgCount > 1 ? 's' : ''} non lu${newMsgCount > 1 ? 's' : ''}` : ''}
      </div>

      {/* Reaction popup */}
      {reactionPopup && (
        <ReactionPopup
          emoji={reactionPopup.emoji}
          users={reactionPopup.users}
          x={reactionPopup.x}
          y={reactionPopup.y}
          onClose={() => setReactionPopup(null)}
        />
      )}

      {/* User popup */}
      {popup && (
        <UserPopup
          userId={popup.userId}
          anchorX={popup.x}
          anchorY={popup.y}
          onClose={() => setPopup(null)}
        />
      )}

      {/* Modal historique des modifications */}
      {editHistoryMsg && (
        <EditHistoryModal
          messageId={editHistoryMsg.id}
          serverId={serverId}
          channelId={channelId}
          onClose={() => setEditHistoryMsg(null)}
        />
      )}

      {/* Modal transfert de message */}
      {forwardingMsg && (
        <ForwardModal
          messageId={forwardingMsg.id}
          sourceChannelId={channelId}
          sourceServerId={serverId}
          onClose={() => setForwardingMsg(null)}
        />
      )}

      {/* Double-click quick emoji popover */}
      {dblClickPopover && (
        <div
          className="fixed z-50"
          style={{ left: Math.max(8, Math.min(dblClickPopover.x - 80, window.innerWidth - 200)), top: Math.max(8, dblClickPopover.y - 48) }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 bg-fc-bg border border-fc-hover rounded-full shadow-xl px-2 py-1.5">
            {DBLCLICK_EMOJIS.map(emoji => (
              <button
                key={emoji}
                onClick={() => {
                  onAddReaction?.(dblClickPopover.msgId, emoji)
                  setDblClickPopover(null)
                }}
                className="text-xl hover:scale-125 transition-transform p-1 rounded-full hover:bg-fc-hover"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal signalement message */}
      {reportingMsg && (
        <ReportModal
          messageId={reportingMsg}
          onClose={() => setReportingMsg(null)}
        />
      )}

      {lightbox && (
        <LightboxModal
          images={lightbox.images}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Picker complet « Plus de réactions » (bottom-sheet mobile via PickerShell) */}
      {fullEmojiFor && (
        <div className="relative">
          <EmojiPicker
            serverId={serverId}
            onPick={emoji => toggleReaction(fullEmojiFor, emoji)}
            onClose={() => setFullEmojiFor(null)}
          />
        </div>
      )}

      {/* Context menu : bottom-sheet sur mobile, menu positionné sur desktop */}
      {contextMenu && window.innerWidth < 768 && (
        <div className="fixed inset-0 z-[199] bg-black/50" aria-hidden onClick={() => setContextMenu(null)} />
      )}
      {contextMenu && (
        <div
          className={window.innerWidth < 768
            ? 'fixed z-[200] bottom-0 inset-x-0 bg-fc-bg border-t border-fc-hover rounded-t-2xl shadow-2xl pt-1 pb-[max(env(safe-area-inset-bottom),0.5rem)] text-sm overflow-y-auto overscroll-contain sheet-slide-up'
            : 'fixed z-[200] bg-fc-bg border border-fc-hover rounded-xl shadow-2xl py-1 w-52 text-sm overflow-y-auto'}
          style={window.innerWidth < 768
            ? { maxHeight: '70dvh' }
            : {
                left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 220)),
                top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 440)),
                maxHeight: Math.min(440, window.innerHeight - 16),
              }}
          onClick={e => e.stopPropagation()}
        >
          {/* Poignée du bottom-sheet mobile */}
          <div className="md:hidden mx-auto mt-1 mb-1.5 w-10 h-1 rounded-full bg-fc-hover" aria-hidden />
          {/* Barre d'emojis rapides — particulièrement utile sur mobile */}
          <div className="flex items-center justify-around px-1 py-1.5 border-b border-fc-hover/50">
            {quickEmojisArr.map(emoji => (
              <button
                key={emoji}
                onClick={() => { toggleReaction(contextMenu.msg.id, emoji); setContextMenu(null) }}
                className="text-xl hover:scale-125 transition-transform active:scale-110 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-fc-hover"
                title={`Réagir ${emoji}`}
                aria-label={`Réagir avec ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <button
              onClick={() => { setFullEmojiFor(contextMenu.msg.id); setContextMenu(null) }}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-fc-hover text-fc-muted hover:text-white transition"
              title="Plus de réactions"
              aria-label="Choisir une autre réaction"
            >
              <SmilePlus size={20} aria-hidden />
            </button>
          </div>
          {contextMenu.msg.content && (
            <button
              onClick={() => { navigator.clipboard.writeText(contextMenu.msg.content); setContextMenu(null) }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
            >
              <Copy size={14} /> Copier le texte
            </button>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(messageLink(contextMenu.msg.id))
              toast.success('Lien copié')
              setContextMenu(null)
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
          >
            <Link size={14} /> Copier le lien
          </button>
          {typeof navigator.share === 'function' && (
            <button
              onClick={() => {
                navigator.share({
                  title: 'Message ForgeChat',
                  text: contextMenu.msg.content ? stripMarkdown(contextMenu.msg.content).slice(0, 200) : undefined,
                  url: messageLink(contextMenu.msg.id),
                }).catch(() => { /* partage annulé par l'utilisateur */ })
                setContextMenu(null)
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
            >
              <Share2 size={14} /> Partager
            </button>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(contextMenu.msg.id); setContextMenu(null) }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-muted text-xs"
          >
            <Copy size={12} /> Copier l'ID du message
          </button>

          <div className="border-t border-fc-hover my-1" />

          <button
            onClick={() => { onReply?.(contextMenu.msg); setContextMenu(null) }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
          >
            <CornerUpLeft size={14} /> Répondre
          </button>

          {onOpenThread && (
            <button
              onClick={() => { onOpenThread(contextMenu.msg.id); setContextMenu(null) }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
            >
              <MessagesSquare size={14} /> Créer un fil
            </button>
          )}

          <button
            onClick={() => { setForwardingMsg({ id: contextMenu.msg.id }); setContextMenu(null) }}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
          >
            <Forward size={14} className="rotate-180" /> Transférer
          </button>

          {onPinMessage && (
            <button
              onClick={() => { onPinMessage(contextMenu.msg.id, !!contextMenu.msg.pinned); setContextMenu(null) }}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
            >
              <Pin size={14} /> {contextMenu.msg.pinned ? 'Désépingler' : 'Épingler'}
            </button>
          )}

          {(contextMenu.msg.author_id === user?.id || canManageMessages) && (
            <>
              <div className="border-t border-fc-hover my-1" />
              {contextMenu.msg.author_id === user?.id && (
                <button
                  onClick={() => { startEdit(contextMenu.msg.id); setContextMenu(null) }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-text"
                >
                  <Pencil size={14} /> Modifier
                </button>
              )}
              <button
                onClick={() => { setDeleteConfirmId(contextMenu.msg.id); setContextMenu(null) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-red"
              >
                <Trash2 size={14} /> Supprimer
              </button>
            </>
          )}

          {contextMenu.msg.author_id !== user?.id && (
            <>
              <div className="border-t border-fc-hover my-1" />
              <button
                onClick={() => { setReportingMsg(contextMenu.msg.id); setContextMenu(null) }}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 min-h-[44px] hover:bg-fc-hover transition text-fc-red"
              >
                <Flag size={14} /> Signaler
              </button>
            </>
          )}
        </div>
      )}
      {/* Modale confirmation suppression */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[300] px-4" onClick={() => setDeleteConfirmId(null)}>
          <div className="bg-fc-channel rounded-xl shadow-2xl w-full max-w-[440px] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-fc-hover">
              <h3 className="text-white font-semibold">Supprimer le message</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-fc-text text-sm">Êtes-vous sûr de vouloir supprimer ce message ? Cette action est irréversible.</p>
            </div>
            <div className="px-5 pb-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 rounded text-sm text-fc-text hover:text-white hover:bg-fc-hover transition"
              >
                Annuler
              </button>
              <button
                onClick={() => { onDeleteMessage(deleteConfirmId); setDeleteConfirmId(null) }}
                className="px-4 py-2 rounded text-sm font-medium bg-fc-red hover:bg-red-500 text-white transition"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      {avatarCtxMenu.node}
    </div>
  )
}
