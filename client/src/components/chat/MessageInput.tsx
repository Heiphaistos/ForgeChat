import { useRef, useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  Plus, SmilePlus, Send, X, CornerUpLeft, Clock, Image, Film, File, Trash2, CalendarClock, Slash,
  Bold, Italic, Strikethrough, Code, Terminal, Quote, Link, Mic, Zap, Edit3, Paperclip, BarChart3, MapPin,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { Link as RouterLink } from 'react-router-dom'
import { maybeCompressImage, formatBytes } from '../../utils/compressImage'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWs } from '../../store/ws'
import { useDraft, useChat } from '../../store/chat'
import { useAuth } from '../../store/auth'
import api, { mediaUrl } from '../../api/client'
import { encodeMentions } from '../../utils/mentions'
import toast from 'react-hot-toast'
import { formatStickerMessage } from './sticker-utils'
import type { Sticker } from './sticker-utils'
// Import statique : EmojiPicker est déjà importé statiquement par MessageList
// et GroupDMPage — le lazy était inopérant (warning INEFFECTIVE_DYNAMIC_IMPORT)
import EmojiPicker from './EmojiPicker'
const GifPicker = lazy(() => import('./GifPicker'))
const StickerPicker = lazy(() => import('./StickerPicker'))
import { useFormatDate } from '../../hooks/useFormatDate'
import { useTypeToFocus } from '../../hooks/useTypeToFocus'
import { filesExtra, prepareFiles, uploadPrepared } from '../../e2e/files'
import VoiceMessageRecorder from './VoiceMessageRecorder'
import QuickReplies from './QuickReplies'
import PickerShell, { PickerFallback } from '../ui/PickerShell'
import { t as tr, useT, type Key } from '../../i18n'
import { mustEncrypt, openMessages, withSeal } from '../../e2e/conversations'
import { currentGeo } from '../../lib/geo'
import { buildPoll } from '../../lib/encPoll'
import { channelSendError, postMessage, sendChannel } from '../../e2e/channels'
import { commandUsage, useServerCommands } from '../../lib/serverCommands'
import { sealPoll } from '../../e2e/channelScopes'
import { outgoingText, useUxPrefs } from '../../lib/uxPrefs'
import { renderMarkdown } from '../../utils/markdown'

// ─── Emoji shortcodes ────────────────────────────────────────────────────────

const EMOJI_MAP: Record<string, string> = {
  smile: '😊', joy: '😂', rofl: '🤣', heart: '❤️', thumbsup: '+1',
  thumbsdown: '-1', fire: '🔥', star: '⭐', check: '✅', x: '❌',
  wave: '👋', clap: '👏', pray: '🙏', muscle: '💪', eyes: '👀',
  thinking: '🤔', sob: '😭', sweat_smile: '😅', flushed: '😳',
  sunglasses: '😎', wink: '😉', partying: '🥳', rocket: '🚀',
  tada: '🎉', sparkles: '✨', crown: '👑', trophy: '🏆', lightning: '⚡',
  poop: '💩', ghost: '👻', skull: '💀', alien: '👽', robot: '🤖',
  cat: '🐱', dog: '🐶', panda: '🐼', fox: '🦊', wolf: '🐺',
  snail: '🐌', bug: '🐛', bee: '🐝', butterfly: '🦋', snake: '🐍',
  pizza: '🍕', burger: '🍔', sushi: '🍣', cake: '🎂', cookie: '🍪',
  coffee: '☕', beer: '🍺', wine: '🍷', tada_cake: '🎊', gem: '💎',
  money: '💰', bank: '🏦', hammer: '🔨', wrench: '🔧', key: '🔑',
  lock: '🔒', unlock: '🔓', bell: '🔔', no_bell: '🔕', loudspeaker: '📢',
  mega: '📣', envelope: '✉️', bookmark: '🔖', books: '📚', pencil: '✏️',
  computer: '💻', phone: '📱', camera: '📷', tv: '📺', headphones: '🎧',
  gamepad: '🎮', soccer: '⚽', basketball: '🏀', tennis: '🎾', golf: '⛳',
  sun: '☀️', moon: '🌙', cloud: '☁️', rain: '🌧️', snow: '❄️',
  earth: '🌍', tree: '🌲', rose: '🌹', sunflower: '🌻', mushroom: '🍄',
  rainbow: '🌈', ok_hand: '👌', peace: '✌️', salute: '🫡', point_right: '👉',
  point_left: '👈', point_up: '☝️', point_down: '👇', v: '✌️', metal: '🤘',
  call_me: '🤙', handshake: '🤝', hug: '🤗', shrug: '🤷', facepalm: '🤦',
  running: '🏃', dancer: '💃', party: '🎊', confused: '😕', angry: '😠',
  rage: '😡', cry: '😢', scream: '😱', hushed: '😯', gasp: '😲',
  pleading: '🥺', monocle: '🧐', nerd: '🤓', cool: '😎', imp: '👿',
  innocent: '😇', kissing: '😘', smirk: '😏', unamused: '😒', tired: '😫',
  weary: '😩', sleeping: '😴', sick: '🤒', mask: '😷', cold: '🥶',
  hot: '🥵', dizzy: '😵', exploding: '🤯', cowboy: '🤠', clown: '🤡',
}

// ─── Slash Commands ───────────────────────────────────────────────────────────

const MAX_CHARS = 4000

// Libellés = clés de traduction
const MSG_TTL_OPTIONS: { label: Key; value: number | null }[] = [
  { label: 'input.ttl.none', value: null },
  { label: 'input.ttl.5min', value: 300 },
  { label: 'input.ttl.1h', value: 3600 },
  { label: 'input.ttl.24h', value: 86400 },
  { label: 'input.ttl.7d', value: 604800 },
]

interface SlashCommand {
  name: string
  description: string
  usage: string
  isBot?: boolean
  botName?: string
  dangerous?: boolean
}

// Description et syntaxe : clés slash.<nom> et slash.<nom>.usage.
const BUILTIN_COMMANDS = ['me', 'shrug', 'tableflip', 'unflip', 'lenny', 'clap', 'spoiler', 'giphy'] as const

function executeSlashCommand(
  name: string,
  args: string,
  setContent: (v: string) => void,
  setShowGifPicker: (v: boolean) => void,
  onSend: (content: string) => void,
): boolean {
  switch (name) {
    case 'me':
      if (args) { onSend(`*${args}*`); return true }
      return false
    case 'shrug':
      onSend('¯\\_(ツ)_/¯'); return true
    case 'tableflip':
      onSend('(╯°□°）╯︵ ┻━┻'); return true
    case 'unflip':
      onSend('┬─┬ ノ( ゜-゜ノ)'); return true
    case 'lenny':
      onSend('( ͡° ͜ʖ ͡°)'); return true
    case 'clap':
      if (args) { onSend(args.split(' ').join(' 👏 ') + ' 👏'); return true }
      return false
    case 'spoiler':
      if (args) { onSend(`||${args}||`); return true }
      return false
    case 'giphy':
      setContent(args ? args : '')
      setShowGifPicker(true)
      return true
    default:
      return false
  }
}

export interface ReplyTarget {
  id: string
  author_username: string
  content: string | null
}

export interface FileWithTtl {
  file: File
  ttlHours: number | null
  preview: string | null
}

interface Props {
  channelId: string
  serverId?: string
  /** Conversation privée : MP (défaut) ou groupe. */
  convKind?: 'dm' | 'group'
  placeholder?: string
  /** `replyPing` : réponse dans un salon, notifier l'auteur cité (false = sans mention). */
  onSend: (content: string, replyTo?: string, files?: FileWithTtl[], ttlSeconds?: number | null, replyPing?: boolean) => void
  onEdit?: (messageId: string, content: string) => void
  replyTo?: ReplyTarget | null
  onCancelReply?: () => void
  sending?: boolean
}

interface MentionUser {
  id: string
  username: string
  avatar?: string | null
  discriminator: string
}

interface MentionRole {
  id: string
  name: string
  color: number
  mentionable: boolean
  is_everyone: boolean
}

// Entrée de l'autocomplétion @ : membre, rôle mentionnable, ou @everyone / @here
// (le serveur ne notifie ces deux-là que si l'auteur a MENTION_EVERYONE).
type MentionOption =
  | { kind: 'user'; key: string; name: string; token: string; user: MentionUser }
  | { kind: 'role'; key: string; name: string; token: string; color: number }
  | { kind: 'special'; key: string; name: string; token: null }

interface ChannelItem {
  id: string
  name: string
  type: string
}

const TTL_OPTIONS: { label: Key; value: number | null }[] = [
  { label: 'input.ttl.never', value: null },
  { label: 'input.ttl.1h', value: 1 },
  { label: 'input.ttl.24h', value: 24 },
  { label: 'input.ttl.7d', value: 168 },
  { label: 'input.ttl.30d', value: 720 },
]

function isVideo(file: File) { return file.type.startsWith('video/') }
function isImage(file: File) { return file.type.startsWith('image/') }

function FileIcon({ file }: { file: File }) {
  if (isImage(file)) return <Image size={14} className="text-blue-400" />
  if (isVideo(file)) return <Film size={14} className="text-purple-400" />
  return <File size={14} className="text-fc-muted" />
}

export default function MessageInput({ channelId, serverId, convKind = 'dm', placeholder, onSend, onEdit, replyTo, onCancelReply, sending }: Props) {
  const t = useT()
  const { drafts, setDraft, clearDraft } = useDraft()
  const me = useAuth(s => s.user)
  const { formatShortDate } = useFormatDate()
  const [content, setContent] = useState(() => drafts[channelId] ?? '')
  const [files, setFiles] = useState<FileWithTtl[]>([])
  const filesRef = useRef<FileWithTtl[]>([])
  useEffect(() => { filesRef.current = files }, [files])
  const clearFiles = useCallback(() => {
    filesRef.current.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview) })
    setFiles([])
  }, [])
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showMentions, setShowMentions] = useState(false)
  const [channelQuery, setChannelQuery] = useState('')
  const [channelIndex, setChannelIndex] = useState(0)
  const [showChannels, setShowChannels] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [showStickerPicker, setShowStickerPicker] = useState(false)
  const [showScheduled, setShowScheduled] = useState(false)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [showPollCreator, setShowPollCreator] = useState(false)
  const [pollQuestion, setPollQuestion] = useState('')
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollMultiple, setPollMultiple] = useState(false)
  const [pollAnonymous, setPollAnonymous] = useState(false)
  const [pollEndsAt, setPollEndsAt] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)
  const [msgTtl, setMsgTtl] = useState<number | null>(null)
  const [showTtlPicker, setShowTtlPicker] = useState(false)
  // Slash commands
  const [showSlash, setShowSlash] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  // Inline link popup (replaces window.prompt)
  const [showLinkPopup, setShowLinkPopup] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')
  const [linkSelection, setLinkSelection] = useState<{ start: number; end: number; text: string }>({ start: 0, end: 0, text: '' })
  // Emoji autocomplete
  const [showEmojiAuto, setShowEmojiAuto] = useState(false)
  const [emojiAutoQuery, setEmojiAutoQuery] = useState('')
  const [emojiAutoIndex, setEmojiAutoIndex] = useState(0)
  // Edition de message (↑ sur input vide)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { send } = useWs()
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const ux = useUxPrefs()
  // Réponse : mention de l'auteur cité (réglage par défaut, modifiable pour chaque réponse).
  const [replyPing, setReplyPing] = useState(ux.replyPing)
  useEffect(() => { setReplyPing(useUxPrefs.getState().replyPing) }, [replyTo?.id])
  const queryClient = useQueryClient()

  const { data: mentionResults = [] } = useQuery<MentionUser[]>({
    queryKey: ['mention_search', serverId, mentionQuery],
    queryFn: () => {
      const url = serverId
        ? `/users/search?q=${encodeURIComponent(mentionQuery)}&server_id=${serverId}`
        : `/users/search?q=${encodeURIComponent(mentionQuery)}`
      return api.get(url).then(r => r.data)
    },
    enabled: showMentions && mentionQuery.length >= 1,
  })

  const { data: serverRoles = [] } = useQuery<MentionRole[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
    enabled: showMentions && !!serverId,
    staleTime: 60_000,
  })

  // `@nom` affiché dans la zone de saisie → jeton envoyé (<@id>, <@&id>).
  const pickedMentions = useRef(new Map<string, string>())
  useEffect(() => { pickedMentions.current.clear() }, [channelId])
  // Action « Mentionner » de la liste des membres (MemberList.tsx)
  useEffect(() => {
    const onPicked = (e: Event) => {
      const { name, token } = (e as CustomEvent<{ name: string; token: string }>).detail ?? {}
      if (name && token) pickedMentions.current.set(name, token)
    }
    window.addEventListener('forgechat:mention-picked', onPicked)
    return () => window.removeEventListener('forgechat:mention-picked', onPicked)
  }, [])

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const q = mentionQuery.toLowerCase()
    const users: MentionOption[] = (mentionQuery.length >= 1 ? mentionResults : []).map(u => (
      { kind: 'user', key: `u${u.id}`, name: u.username, token: `<@${u.id}>`, user: u }
    ))
    if (!serverId) return users
    const roles: MentionOption[] = serverRoles
      .filter(r => r.mentionable && !r.is_everyone && r.name.toLowerCase().startsWith(q))
      .slice(0, 5)
      .map(r => ({ kind: 'role', key: `r${r.id}`, name: r.name, token: `<@&${r.id}>`, color: r.color }))
    const specials: MentionOption[] = (['everyone', 'here'] as const)
      .filter(n => n.startsWith(q))
      .map(n => ({ kind: 'special', key: n, name: n, token: null }))
    return [...users, ...roles, ...specials]
  }, [mentionQuery, mentionResults, serverRoles, serverId])

  const { data: allServerChannels = [] } = useQuery<ChannelItem[]>({
    queryKey: ['server_channels_list', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data.channels ?? []),
    enabled: !!serverId,
    staleTime: 30_000,
  })

  const channelResults = channelQuery
    ? allServerChannels.filter(c => c.name.toLowerCase().includes(channelQuery.toLowerCase())).slice(0, 5)
    : allServerChannels.slice(0, 5)

  // Commandes du serveur (natives + bots) : seules celles que le serveur m'autorise sont proposées.
  const { data: serverCommands = [] } = useServerCommands(serverId)

  // Fusion builtin + bot commands
  const allSlashCommands: SlashCommand[] = [
    ...BUILTIN_COMMANDS.map(name => ({ name, description: t(`slash.${name}`), usage: t(`slash.${name}.usage`) })),
    ...serverCommands.filter(bc => bc.allowed).map(bc => ({
      name: bc.name,
      description: bc.description,
      usage: commandUsage(bc),
      isBot: true,
      botName: bc.bot_name,
      dangerous: bc.dangerous,
    })),
  ]

  const filteredSlashCommands = slashQuery
    ? allSlashCommands.filter(c => c.name.startsWith(slashQuery.toLowerCase()))
    : allSlashCommands

  const { data: customEmojis = [] } = useQuery<{ id: string; name: string; url: string }[]>({
    queryKey: ['custom_emojis', serverId],
    queryFn: () => api.get(`/servers/${serverId}/emojis`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  const { data: scheduledMessages = [] } = useQuery<any[]>({
    queryKey: ['scheduled_messages', serverId, channelId],
    queryFn: () =>
      api.get(`/servers/${serverId}/channels/${channelId}/scheduled`).then(r => openMessages('channel', channelId, r.data)),
    enabled: showScheduled,
    staleTime: 15_000,
  })

  const createScheduled = useMutation({
    // Chiffré à la création (portée du salon) : le serveur le recopie tel quel à l'heure dite.
    mutationFn: ({ content, send_at }: { content: string; send_at: string }) =>
      sendChannel(channelId, content, body => api.post(`/servers/${serverId}/channels/${channelId}/scheduled`, {
        ...body, content: body.content ?? '', send_at,
      }), { serverId: serverId ?? '', preview: true }),
    onSuccess: () => {
      toast.success(tr('input.scheduled'))
      setScheduledAt('')
      setContent('')
      queryClient.invalidateQueries({ queryKey: ['scheduled_messages', serverId, channelId] })
    },
    onError: (e: any) => toast.error(channelSendError(e, e.response?.data?.error ?? tr('common.error'))),
  })

  const deleteScheduled = useMutation({
    mutationFn: (id: string) => api.delete(`/scheduled/${id}`),
    onSuccess: () => {
      toast.success(tr('input.scheduleCancelled'))
      queryClient.invalidateQueries({ queryKey: ['scheduled_messages', serverId, channelId] })
    },
    onError: () => toast.error(tr('input.cancelFailed')),
  })

  // Le backend (create_poll/get_poll/vote_poll/close_poll + PollDisplay côté
  // affichage) était déjà 100% prêt et testé, mais aucune UI n'appelait jamais
  // POST .../polls -- la feature "sondage" n'avait littéralement aucun moyen
  // d'être créée depuis l'interface, malgré un affichage/vote/fermeture complets.
  const createPoll = useMutation({
    // Salon chiffré : question et options chiffrées (portée du sondage), textes vides côté serveur.
    mutationFn: () =>
      sealPoll(serverId ?? '', channelId, pollQuestion.trim(), pollOptions.map(o => o.trim()).filter(Boolean), body =>
        api.post(`/servers/${serverId}/channels/${channelId}/polls`, {
          ...body, multiple_choice: pollMultiple, anonymous: pollAnonymous,
          ends_at: pollEndsAt ? new Date(pollEndsAt).toISOString() : undefined,
        })),
    onSuccess: () => {
      toast.success(tr('input.pollCreated'))
      setShowPollCreator(false)
      setPollQuestion('')
      setPollOptions(['', ''])
      setPollMultiple(false)
      setPollAnonymous(false)
      setPollEndsAt('')
    },
    onError: (e: any) => toast.error(channelSendError(e, e.response?.data?.error ?? tr('common.error'))),
  })

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => addFiles(accepted),
  })

  const addFiles = useCallback(async (newFiles: File[]) => {
    const MAX_SIZE = 500 * 1024 * 1024 // = server/src/config.rs (gratuit ; Discord Nitro : 500 Mo)
    const oversized = newFiles.filter(f => f.size > MAX_SIZE)
    if (oversized.length > 0) {
      toast.error(tr(oversized.length > 1 ? 'input.tooBig.other' : 'input.tooBig.one', { names: oversized.map(f => f.name).join(', ') }))
    }
    const valid = newFiles.filter(f => f.size <= MAX_SIZE)
    if (valid.length === 0) return
    // Compression des photos JPEG volumineuses avant upload (mobile)
    const processed = await Promise.all(valid.map(maybeCompressImage))
    const before = valid.reduce((a, f) => a + f.size, 0)
    const after = processed.reduce((a, f) => a + f.size, 0)
    if (before - after > 500_000) {
      toast.success(tr('input.photoOptimized', { before: formatBytes(before), after: formatBytes(after) }), { duration: 3000 })
    }
    const wrapped: FileWithTtl[] = processed.map(f => ({
      file: f,
      ttlHours: isVideo(f) ? 24 : null,
      preview: (isImage(f) || isVideo(f)) ? URL.createObjectURL(f) : null,
    }))
    setFiles(prev => [...prev, ...wrapped])
  }, [])

  // Coller image depuis le presse-papiers
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      // Tout fichier collé (image, PDF, zip... copié depuis l'explorateur),
      // en ignorant les items texte pour laisser le collage de texte normal
      const fileItems = Array.from(items).filter(i => i.kind === 'file')
      if (fileItems.length === 0) return
      const filesFromClipboard = fileItems.map(i => i.getAsFile()).filter(Boolean) as File[]
      if (filesFromClipboard.length > 0) {
        e.preventDefault()
        addFiles(filesFromClipboard)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [addFiles])

  // Drop de fichiers n'importe où sur la page (pas seulement le composer) :
  // overlay plein écran qui capte le drop et alimente les pièces jointes
  const [winDragging, setWinDragging] = useState(false)
  const dragDepth = useRef(0)
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current++; setWinDragging(true) }
    const onLeave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setWinDragging(false) }
    const onDropWin = () => { dragDepth.current = 0; setWinDragging(false) }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDropWin)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDropWin)
    }
  }, [])

  // Libérer les URLs de preview — utilise une ref pour capturer l'état courant au démontage
  useEffect(() => () => filesRef.current.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview) }), [])

  const removeFile = (idx: number) => {
    setFiles(prev => {
      if (prev[idx]?.preview) URL.revokeObjectURL(prev[idx].preview!)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const updateTtl = (idx: number, ttlHours: number | null) => {
    setFiles(prev => prev.map((f, i) => i === idx ? { ...f, ttlHours } : f))
  }

  const detectMention = (value: string, pos: number) => {
    const before = value.slice(0, pos)
    const mentionMatch = before.match(/@(\w*)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1])
      setMentionIndex(0)
      setShowMentions(true)
      setShowChannels(false)
      return
    }
    setShowMentions(false)

    const channelMatch = before.match(/#([\w-]*)$/)
    if (channelMatch) {
      setChannelQuery(channelMatch[1])
      setChannelIndex(0)
      setShowChannels(true)
    } else {
      setShowChannels(false)
    }
  }

  const insertChannel = (channel: ChannelItem) => {
    const pos = cursorPos
    const before = content.slice(0, pos)
    const after = content.slice(pos)
    const hashIdx = before.lastIndexOf('#')
    const newContent = before.slice(0, hashIdx) + `#${channel.name} ` + after
    setContent(newContent)
    setShowChannels(false)
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = hashIdx + channel.name.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  const detectSlash = (value: string) => {
    // Slash command : input commence par "/" en début de message
    if (value.startsWith('/')) {
      const withoutSlash = value.slice(1)
      // Tant qu'il n'y a pas d'espace → on est encore dans le nom de la commande
      if (!withoutSlash.includes(' ')) {
        setSlashQuery(withoutSlash)
        setSlashIndex(0)
        setShowSlash(true)
        return
      }
    }
    setShowSlash(false)
  }

  const detectEmojiAuto = (value: string, pos: number) => {
    const before = value.slice(0, pos)
    const m = before.match(/:([a-z0-9_+]+)$/)
    if (m && m[1].length >= 2) {
      setEmojiAutoQuery(m[1])
      setEmojiAutoIndex(0)
      setShowEmojiAuto(true)
    } else {
      setShowEmojiAuto(false)
    }
  }

  type EmojiEntry = { name: string; char?: string; custom?: { id: string; url: string } }
  const emojiAutoResults: EmojiEntry[] = emojiAutoQuery ? [
    ...Object.entries(EMOJI_MAP)
      .filter(([k]) => k.startsWith(emojiAutoQuery))
      .slice(0, 8)
      .map(([name, char]) => ({ name, char })),
    ...customEmojis
      .filter(e => e.name.toLowerCase().startsWith(emojiAutoQuery.toLowerCase()))
      .slice(0, 5)
      .map(e => ({ name: e.name, custom: { id: e.id, url: e.url } })),
  ].slice(0, 10) : []

  const selectEmojiAuto = (entry: EmojiEntry) => {
    const emoji = entry.char ?? (entry.custom ? `<:${entry.name}:${entry.custom.id}>` : '')
    if (!emoji) return
    const pos = cursorPos
    const before = content.slice(0, pos)
    const after = content.slice(pos)
    const colonIdx = before.lastIndexOf(':')
    const newContent = before.slice(0, colonIdx) + emoji + ' ' + after
    const newPos = colonIdx + emoji.length + 1
    setContent(newContent)
    setShowEmojiAuto(false)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  const selectSlashCommand = (cmd: SlashCommand) => {
    if (cmd.isBot) {
      // Pour les bot commands : on envoie /cmdname args tel quel (bot reçoit via WS)
      setContent(`/${cmd.name} `)
      setShowSlash(false)
      setTimeout(() => textareaRef.current?.focus(), 0)
    } else {
      // Pré-remplir avec le nom de la commande + espace pour que l'user tape les args
      const needsArgs = ['me', 'clap', 'spoiler', 'giphy'].includes(cmd.name)
      if (needsArgs) {
        setContent(`/${cmd.name} `)
        setShowSlash(false)
        setTimeout(() => textareaRef.current?.focus(), 0)
      } else {
        // Exécuter directement
        const executed = executeSlashCommand(cmd.name, '', setContent, setShowGifPicker, (msg) => {
          onSend(msg, replyTo?.id)
          onCancelReply?.()
          setContent('')
          clearFiles()
        })
        if (executed) {
          setContent('')
          setShowSlash(false)
        }
      }
    }
  }

  const insertMention = (opt: MentionOption) => {
    const pos = cursorPos
    const before = content.slice(0, pos)
    const after = content.slice(pos)
    const atIdx = before.lastIndexOf('@')
    const newContent = before.slice(0, atIdx) + `@${opt.name} ` + after
    if (opt.token) pickedMentions.current.set(opt.name, opt.token)
    setContent(newContent)
    setShowMentions(false)
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = atIdx + opt.name.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  // Wrapper le texte sélectionné avec des marqueurs markdown (préfixe = suffixe)
  const wrapSelection = (marker: string) => {
    applyFormat(marker, marker)
  }

  // Appliquer un format markdown avec préfixe et suffixe distincts
  const applyFormat = (prefix: string, suffix: string = prefix) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.slice(start, end)
    const replacement = prefix + (selected || 'texte') + suffix
    const newContent = content.slice(0, start) + replacement + content.slice(end)
    setContent(newContent)
    setTimeout(() => {
      ta.focus()
      const newStart = start + prefix.length
      const newEnd = newStart + (selected || 'texte').length
      ta.setSelectionRange(newStart, newEnd)
    }, 0)
  }

  const insertLink = () => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const text = content.slice(start, end) || 'texte'
    setLinkSelection({ start, end, text })
    setLinkUrl('https://')
    setShowLinkPopup(true)
  }

  const confirmInsertLink = () => {
    if (!linkUrl || linkUrl === 'https://') return
    const { start, end, text } = linkSelection
    const newContent = content.slice(0, start) + `[${text}](${linkUrl})` + content.slice(end)
    setContent(newContent)
    setShowLinkPopup(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showEmojiAuto && emojiAutoResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiAutoIndex(i => Math.min(i + 1, emojiAutoResults.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setEmojiAutoIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); selectEmojiAuto(emojiAutoResults[emojiAutoIndex]); return }
      if (e.key === 'Escape') { setShowEmojiAuto(false); return }
    }
    if (showSlash && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, filteredSlashCommands.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && showSlash)) {
        e.preventDefault()
        selectSlashCommand(filteredSlashCommands[slashIndex])
        return
      }
      if (e.key === 'Escape') { setShowSlash(false); return }
    }
    if (showMentions && mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionOptions.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && showMentions)) { e.preventDefault(); insertMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]); return }
      if (e.key === 'Escape') { setShowMentions(false); return }
    }
    if (showChannels && channelResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setChannelIndex(i => Math.min(i + 1, channelResults.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setChannelIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && showChannels)) { e.preventDefault(); insertChannel(channelResults[channelIndex]); return }
      if (e.key === 'Escape') { setShowChannels(false); return }
    }
    // Ctrl+B/I/U/K → markdown shortcuts; Ctrl+Shift+X → ~~barré~~
    if (e.ctrlKey && !e.altKey) {
      if (!e.shiftKey) {
        if (e.key === 'b' || e.key === 'B') { e.preventDefault(); wrapSelection('**'); return }
        if (e.key === 'i' || e.key === 'I') { e.preventDefault(); wrapSelection('*'); return }
        if (e.key === 'u' || e.key === 'U') { e.preventDefault(); wrapSelection('__'); return }
        if (e.key === 'k' || e.key === 'K') { e.preventDefault(); insertLink(); return }
      }
      if (e.shiftKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); wrapSelection('~~'); return }
    }
    // ↑ sur input vide → éditer le dernier message de l'utilisateur
    if (e.key === 'ArrowUp' && content === '' && !editingMsgId && onEdit) {
      const msgs = useChat.getState().messagesByChannel[channelId] ?? []
      const last = [...msgs].reverse().find(m => m.author_id === me?.id && m.type !== 'system')
      if (last) {
        e.preventDefault()
        setEditingMsgId(last.id)
        setContent(last.content ?? '')
        return
      }
    }
    // Escape → annuler l'édition en cours
    if (e.key === 'Escape' && editingMsgId) {
      e.preventDefault()
      setEditingMsgId(null)
      setContent('')
      return
    }
    // Envoi : Entrée (Maj+Entrée = retour à la ligne) ou Ctrl+Entrée (Entrée = retour à la ligne).
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'Enter' && !e.shiftKey && (ux.sendKey === 'enter' || ctrl)) { e.preventDefault(); submit() }
  }

  // Réinitialiser le contenu, fichiers et options transientes quand le canal change
  useEffect(() => {
    setContent(drafts[channelId] ?? '')
    clearFiles()
    setMsgTtl(null)
    setScheduledAt('')
    setShowTtlPicker(false)
    setShowScheduled(false)
    // Focus textarea on desktop (pointer:fine = mouse/trackpad) sans déclencher le clavier virtuel mobile
    if (window.matchMedia('(pointer: fine)').matches) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [channelId])

  // Type-to-focus (desktop) : taper hors de tout champ focus le composer
  useTypeToFocus(textareaRef)

  // Restaurer le brouillon si le parent le remet après un échec d'envoi
  // (le champ a été vidé optimistiquement au submit ; ne s'applique que
  // champ vide pour ne jamais écraser une frappe en cours)
  const restoredDraft = drafts[channelId]
  useEffect(() => {
    if (restoredDraft && !content) setContent(restoredDraft)
  }, [restoredDraft])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart ?? 0
    setContent(val)
    setDraft(channelId, val)
    setCursorPos(pos)
    if (ux.mentionSuggest) detectMention(val, pos)
    detectSlash(val)
    if (ux.emojiSuggest) detectEmojiAuto(val, pos)
    // Throttle: send TYPING_START at most once per 3 seconds
    if (!typingTimeout.current) {
      send({ type: 'TYPING_START', channel_id: channelId })
      typingTimeout.current = setTimeout(() => {
        typingTimeout.current = undefined
      }, 3000)
    }
  }

  const submit = () => {
    if (sending) return
    // Mentions choisies → jetons résolus par le serveur (salons seulement)
    // Liens nettoyés et émoticônes converties sur l'appareil, avant le chiffrement.
    const outgoing = outgoingText(content.trim())
    const trimmed = serverId ? encodeMentions(outgoing, pickedMentions.current) : outgoing

    // Limite serveur : 4000 caractères — bloquer avant l'aller-retour réseau
    if (trimmed.length > MAX_CHARS) {
      toast.error(tr('input.tooLong', { n: trimmed.length, max: MAX_CHARS }))
      return
    }

    // Mode édition (↑ sur input vide)
    if (editingMsgId) {
      if (trimmed && onEdit) onEdit(editingMsgId, trimmed)
      setEditingMsgId(null)
      setContent('')
      textareaRef.current?.focus()
      return
    }

    if (!trimmed && files.length === 0) return

    // Essai d'exécution slash command built-in
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(' ')
      const cmdName = parts[0].toLowerCase()
      const args = parts.slice(1).join(' ')
      const isBuiltin = BUILTIN_COMMANDS.some(c => c === cmdName)
      if (isBuiltin) {
        const executed = executeSlashCommand(cmdName, args, setContent, setShowGifPicker, (msg) => {
          onSend(msg, replyTo?.id)
          onCancelReply?.()
        })
        if (executed) {
          setContent('')
          clearDraft(channelId)
          clearFiles()
          setShowSlash(false)
          setShowMentions(false)
          textareaRef.current?.focus()
          return
        }
      }
      // Sinon : c'est peut-être une bot command, on envoie le message tel quel
    }

    onSend(trimmed, replyTo?.id, files.length > 0 ? files : undefined, msgTtl, serverId && replyTo ? replyPing : undefined)
    setContent('')
    clearDraft(channelId)
    clearFiles()
    setShowMentions(false)
    setShowSlash(false)
    setShowChannels(false)
    onCancelReply?.()
    textareaRef.current?.focus()
  }

  const handleSendGif = (gifUrl: string) => {
    onSend(gifUrl, replyTo?.id)
    onCancelReply?.()
    setShowGifPicker(false)
    textareaRef.current?.focus()
  }

  const handleSendSticker = (sticker: Sticker) => {
    onSend(formatStickerMessage(sticker), replyTo?.id)
    onCancelReply?.()
    setShowStickerPicker(false)
    textareaRef.current?.focus()
  }

  const handleVoiceMessage = useCallback(async (blob: Blob, duration: number) => {
    try {
      const mins = Math.floor(duration / 60)
      const secs = duration % 60
      const durationStr = `${mins}:${String(secs).padStart(2, '0')}`
      const content = `🎤 ${tr('input.voiceMessage', { d: durationStr })}`
      // En DM (serverId="") : POST /dms/:id/messages + /dms/:id/messages/:id/attachments
      // -- même contrat (id renvoyé, endpoint d'attachment équivalent) que côté serveur,
      // ce chemin retournait juste tôt avant sans jamais appeler l'API en DM.
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'mp4' : 'webm'
      const file = new globalThis.File([blob], `voice-${Date.now()}.${ext}`, { type: blob.type || `audio/${ext}` })
      // Conversation chiffrée : le son est chiffré ici, sa clé va dans le message chiffré (§12).
      const prepared = await prepareFiles(serverId ? 'channel' : 'dm', channelId, [{ file }])
      const res = serverId
        ? await postMessage(serverId, channelId, content, body => api.post(`/servers/${serverId}/channels/${channelId}/messages`, body), filesExtra(prepared))
        : await withSeal('dm', channelId, content, body => api.post(`/dms/${channelId}/messages`, body), null, { extra: filesExtra(prepared) })
      const uploadUrl = serverId
        ? `/servers/${serverId}/channels/${channelId}/messages/${res.data.id}/attachments`
        : `/dms/${channelId}/messages/${res.data.id}/attachments`
      await uploadPrepared(uploadUrl, prepared)
      setShowVoiceRecorder(false)
    } catch (e) {
      toast.error(channelSendError(e, tr('input.voiceFailed')))
      setShowVoiceRecorder(false)
    }
  }, [channelId, serverId])

  // Partage de position (amélioration n° 34) : coordonnées dans le corps chiffré (`g`). Conversation
  // non chiffrée : refus, la position ne part jamais en clair.
  const shareLocation = useCallback(async () => {
    const kind = serverId ? 'channel' : convKind
    try {
      if (!await mustEncrypt(kind, channelId)) { toast.error(tr('geo.needsE2E')); return }
      const g = await currentGeo()
      await sendExtra(tr('geo.text'), { g })
    } catch (e) {
      toast.error(e instanceof GeolocationPositionError ? tr('geo.denied') : channelSendError(e, tr('geo.failed')))
    }
  }, [channelId, serverId, convKind]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Message chiffré avec un contenu structuré (position, sondage chiffré). */
  const sendExtra = (text: string, extra: Record<string, unknown>) => serverId
    ? postMessage(serverId, channelId, text, body => api.post(`/servers/${serverId}/channels/${channelId}/messages`, body), extra)
    : withSeal(convKind, channelId, text, body => api.post(convKind === 'group' ? `/dms/groups/${channelId}/messages` : `/dms/${channelId}/messages`, body), null, { extra })

  // Sondage chiffré des MP et groupes (amélioration n° 35).
  const [encPollOpen, setEncPollOpen] = useState(false)
  const [encPollQ, setEncPollQ] = useState('')
  const [encPollOpts, setEncPollOpts] = useState('')
  const [encPollMulti, setEncPollMulti] = useState(false)
  const sendEncPoll = async () => {
    const poll = buildPoll(encPollQ, encPollOpts, encPollMulti)
    if (!poll) { toast.error(tr('encpoll.invalid')); return }
    try {
      if (!await mustEncrypt(convKind, channelId)) { toast.error(tr('geo.needsE2E')); return }
      await sendExtra(`📊 ${poll.q}`, { poll })
      setEncPollOpen(false); setEncPollQ(''); setEncPollOpts(''); setEncPollMulti(false)
    } catch (e) {
      toast.error(channelSendError(e, tr('encpoll.failed')))
    }
  }

  const closeAllPickers = () => {
    setShowEmojiPicker(false)
    setShowGifPicker(false)
    setShowStickerPicker(false)
    setShowScheduled(false)
    setShowQuickReplies(false)
    setShowPollCreator(false)
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 144) + 'px'
    }
  }, [content])

  const hasVideos = files.some(f => isVideo(f.file))

  return (
    <div {...getRootProps()} className={`fc-chat-input px-2 md:px-4 pb-2 md:pb-4 relative ${isDragActive ? 'ring-2 ring-fc-accent ring-inset rounded-lg' : ''}`} style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      <input {...getInputProps()} />

      {/* Overlay drop plein écran */}
      {winDragging && (
        <div
          className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center"
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)) }}
        >
          <div className="border-4 border-dashed border-fc-accent rounded-2xl px-10 py-8 bg-fc-bg/90 text-center pointer-events-none">
            <Paperclip size={36} className="mx-auto mb-3 text-fc-accent" aria-hidden />
            <p className="text-white font-semibold">{t('input.dropTitle')}</p>
            <p className="text-fc-muted text-sm mt-1">{t('input.dropHint')}</p>
          </div>
        </div>
      )}

      {/* Barre d'édition (↑ sur input vide) */}
      {editingMsgId && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-fc-input/60 rounded-t-lg border-b border-fc-hover text-xs">
          <Edit3 size={12} className="text-yellow-400 flex-shrink-0" />
          <span className="text-yellow-400 font-medium">{t('input.editing')}</span>
          <span className="text-fc-muted">{t('input.escToCancel')}</span>
          <button onClick={() => { setEditingMsgId(null); setContent('') }} className="ml-auto p-0.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition" title={t('input.cancelEditTitle')} aria-label={t('input.cancelEdit')}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Barre de réponse */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-fc-input/60 rounded-t-lg border-b border-fc-hover text-xs">
          <CornerUpLeft size={12} className="text-fc-accent flex-shrink-0" />
          <span className="text-fc-muted">{t('input.replyingTo')}</span>
          <span className="font-semibold text-white">{replyTo.author_username}</span>
          {replyTo.content && (
            <span className="text-fc-muted truncate max-w-xs">{replyTo.content.slice(0, 80)}</span>
          )}
          {serverId && (
            <button type="button" onClick={() => setReplyPing(v => !v)} aria-pressed={replyPing}
              title={t(replyPing ? 'ux.reply.pingOn' : 'ux.reply.pingOff')}
              className={`ml-auto px-1.5 rounded font-semibold transition ${replyPing ? 'text-fc-accent' : 'text-fc-muted line-through'}`}>
              @{replyPing ? 'ON' : 'OFF'}
            </button>
          )}
          <button onClick={onCancelReply} className={`${serverId ? '' : 'ml-auto '}p-0.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition`} title={t('input.cancel')} aria-label={t('input.cancelReply')}>
            <X size={12} />
          </button>
        </div>
      )}

      {/* Aperçu du markdown, même rendu que les messages */}
      {ux.markdownPreview && /[*_~`|>#[]|^\s*[-\d]/.test(content) && (
        <div aria-label={t('ux.composer.previewLabel')} className="mb-1 px-3 py-1.5 max-h-32 overflow-y-auto rounded-lg bg-fc-input/40 border border-fc-hover text-sm text-fc-text break-words">
          {renderMarkdown(content)}
        </div>
      )}

      {/* Dropdown slash commands */}
      {showSlash && filteredSlashCommands.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto overscroll-contain">
          <div className="px-3 py-1.5 text-xs font-semibold text-fc-muted uppercase tracking-wide border-b border-fc-hover flex items-center gap-1.5">
            <Slash size={10} />
            {t('slash.title')}{slashQuery ? ` — /${slashQuery}` : ''}
          </div>
          {filteredSlashCommands.map((cmd, idx) => (
            <button
              key={cmd.name}
              onClick={() => selectSlashCommand(cmd)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition
                ${idx === slashIndex ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
            >
              <div className="w-7 h-7 rounded bg-fc-hover flex items-center justify-center flex-shrink-0">
                <span className="text-fc-accent font-bold text-sm">/</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{cmd.name}</span>
                  {cmd.isBot && (
                    <span className="text-xs bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-medium">
                      BOT{cmd.botName ? ` · ${cmd.botName}` : ''}
                    </span>
                  )}
                  {cmd.dangerous && (
                    <span className="text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded font-medium">{t('cmd.dangerous')}</span>
                  )}
                </div>
                <div className="text-xs text-fc-muted truncate">{cmd.description}</div>
              </div>
              <div className="text-xs text-fc-muted/60 flex-shrink-0 hidden sm:block">{cmd.usage}</div>
            </button>
          ))}
        </div>
      )}

      {/* Dropdown mentions */}
      {showMentions && mentionOptions.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50 max-h-52 overflow-y-auto overscroll-contain">
          <div className="px-3 py-1.5 text-xs font-semibold text-fc-muted uppercase tracking-wide border-b border-fc-hover">
            Mentions — @{mentionQuery}
          </div>
          {mentionOptions.map((opt, idx) => (
            <button
              key={opt.key}
              onClick={() => insertMention(opt)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition
                ${idx === mentionIndex ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
            >
              {opt.kind === 'user' ? (
                <>
                  <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 overflow-hidden">
                    {opt.user.avatar ? <img src={mediaUrl(opt.user.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : opt.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{opt.name}</div>
                    <div className="text-xs text-fc-muted">#{opt.user.discriminator}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 rounded-full bg-fc-hover flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={opt.kind === 'role' && opt.color ? { color: `#${opt.color.toString(16).padStart(6, '0')}` } : undefined}>@</div>
                  <div>
                    <div className="text-sm font-medium">@{opt.name}</div>
                    <div className="text-xs text-fc-muted">
                      {opt.kind === 'role' ? t('mention.role') : opt.name === 'everyone' ? t('mention.everyone') : t('mention.here')}
                    </div>
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Dropdown channels # */}
      {showChannels && channelResults.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50 max-h-52 overflow-y-auto overscroll-contain">
          <div className="px-3 py-1.5 text-xs font-semibold text-fc-muted uppercase tracking-wide border-b border-fc-hover">
            Canaux — #{channelQuery}
          </div>
          {channelResults.map((ch, idx) => (
            <button
              key={ch.id}
              onClick={() => insertChannel(ch)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition
                ${idx === channelIndex ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
            >
              <div className="w-7 h-7 rounded bg-fc-hover flex items-center justify-center text-xs font-bold text-fc-accent flex-shrink-0">
                #
              </div>
              <div className="text-sm font-medium">{ch.name}</div>
            </button>
          ))}
        </div>
      )}

      {/* Dropdown emoji autocomplete */}
      {showEmojiAuto && emojiAutoResults.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-1.5 text-xs font-semibold text-fc-muted uppercase tracking-wide border-b border-fc-hover">
            Emoji — :{emojiAutoQuery}
          </div>
          <div className="flex flex-wrap gap-1 p-2">
            {emojiAutoResults.map((entry, idx) => (
              <button
                key={entry.name}
                onClick={() => selectEmojiAuto(entry)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition
                  ${idx === emojiAutoIndex ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
              >
                {entry.custom
                  ? <img src={mediaUrl(entry.custom.url)} alt={entry.name} loading="lazy" decoding="async" className="w-5 h-5 object-contain rounded" />
                  : <span className="text-lg leading-none">{entry.char}</span>}
                <span className="text-xs text-fc-muted">:{entry.name}:</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Aperçu fichiers */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap p-2 bg-fc-input/40 rounded-lg border border-fc-hover">
          {files.map((fw, i) => (
            <div key={i} className="relative group flex flex-col gap-1">
              {/* Preview image / première frame vidéo */}
              {fw.preview ? (
                <div className="w-20 h-20 rounded overflow-hidden border border-fc-hover flex-shrink-0">
                  {isVideo(fw.file)
                    ? <video src={fw.preview} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                    : <img src={fw.preview} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
                </div>
              ) : (
                <div className="w-20 h-20 rounded border border-fc-hover bg-fc-bg flex flex-col items-center justify-center gap-0.5 text-center" title={fw.file.name}>
                  <FileIcon file={fw.file} />
                  <span className="text-xs text-fc-muted truncate w-16 text-center px-1">{fw.file.name}</span>
                  <span className="text-[10px] text-fc-muted/70">{formatBytes(fw.file.size)}</span>
                </div>
              )}

              {/* TTL selector pour vidéos */}
              {isVideo(fw.file) && (
                <select
                  value={fw.ttlHours ?? ''}
                  onChange={e => updateTtl(i, e.target.value ? Number(e.target.value) : null)}
                  className="text-xs bg-fc-bg border border-fc-hover rounded px-1 py-0.5 text-fc-muted w-20"
                  title={t('input.lifetime')}
                >
                  {TTL_OPTIONS.map(o => (
                    <option key={String(o.value)} value={o.value ?? ''}>{t(o.label)}</option>
                  ))}
                </select>
              )}

              {/* Bouton supprimer */}
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-fc-red rounded-full flex items-center justify-center text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition"
              >
                <X size={8} />
              </button>
            </div>
          ))}

          {hasVideos && (
            <div className="flex items-center gap-1 text-xs text-fc-muted self-start mt-1">
              <Clock size={10} />
              <span>{t('input.ttlPerFile')}</span>
            </div>
          )}
        </div>
      )}

      {/* Indicateur drag */}
      {isDragActive && (
        <div className="absolute inset-0 bg-fc-accent/10 border-2 border-dashed border-fc-accent rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <span className="text-fc-accent font-semibold text-sm">{t('input.dropHere')}</span>
        </div>
      )}

      <div className="fc-composer-box bg-fc-input rounded-lg">
        {/* Barre Rich Text — toujours sur desktop ; sur mobile dès qu'on tape
            (seul moyen de formater au tactile, masquée composer vide pour l'espace) */}
        <div className={`${content.trim() ? 'flex' : 'hidden'} md:flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-fc-hover overflow-x-auto`}>
          <button onClick={() => applyFormat('**')} title={t('input.boldTitle')} aria-label={t('input.bold')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Bold size={13} /></button>
          <button onClick={() => applyFormat('*')} title={t('input.italicTitle')} aria-label={t('input.italic')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Italic size={13} /></button>
          <button onClick={() => applyFormat('~~')} title={t('input.strike')} aria-label={t('input.strike')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Strikethrough size={13} /></button>
          <div className="w-px h-4 bg-fc-hover mx-0.5" />
          <button onClick={() => applyFormat('`')} title={t('input.inlineCode')} aria-label={t('input.inlineCode')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Code size={13} /></button>
          <button onClick={() => applyFormat('```\n', '\n```')} title={t('input.codeBlock')} aria-label={t('input.codeBlock')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Terminal size={13} /></button>
          <button onClick={() => applyFormat('> ', '')} title={t('input.quote')} aria-label={t('input.quote')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Quote size={13} /></button>
          <div className="w-px h-4 bg-fc-hover mx-0.5" />
          <button onClick={insertLink} title={t('input.linkTitle')} aria-label={t('input.insertLink')} className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Link size={13} /></button>
        </div>

        {/* Popup URL inline */}
        {showLinkPopup && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-fc-bg border border-fc-hover rounded-lg mx-2 mb-1">
            <Link size={12} className="text-fc-muted flex-shrink-0" />
            <input
              autoFocus
              type="url"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmInsertLink() } if (e.key === 'Escape') setShowLinkPopup(false) }}
              placeholder="https://..."
              enterKeyHint="go"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="url"
              className="flex-1 bg-transparent text-white text-xs outline-none placeholder-fc-muted min-w-0"
            />
            <button onClick={confirmInsertLink} className="px-2 py-0.5 text-xs bg-fc-accent hover:bg-indigo-500 text-white rounded transition font-medium">OK</button>
            <button onClick={() => setShowLinkPopup(false)} aria-label={t('common.close')} className="p-1 min-w-[24px] min-h-[24px] flex items-center justify-center text-fc-muted hover:text-white transition rounded">✕</button>
          </div>
        )}

        {/* Layout: colonne sur mobile (textarea ligne 1, boutons ligne 2) | rangée sur desktop */}
        <div className="flex flex-col md:flex-row md:items-end gap-1 md:gap-x-2 px-2 py-2">

        {/* Rangée 1 : bouton + et textarea */}
        <div className="flex items-end gap-2 flex-1 min-w-0">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 text-fc-muted hover:text-white rounded transition flex-shrink-0 flex items-center justify-center"
          title={t('input.attach')}
          aria-label={t('input.attach')}
        >
          <Plus size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) { addFiles(Array.from(e.target.files)); e.target.value = '' } }}
        />

        <textarea
          ref={textareaRef}
          data-message-input="true"
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t('input.placeholder')}
          aria-label={placeholder ?? t('input.label')}
          rows={1}
          className="flex-1 min-w-0 bg-transparent text-fc-text placeholder-fc-muted outline-none resize-none text-sm overflow-y-hidden"
          style={{ lineHeight: '1.5', minHeight: '24px', maxHeight: '144px' }}
          enterKeyHint="send"
          spellCheck={ux.spellcheck}
          autoComplete="off"
          autoCorrect={ux.spellcheck ? 'on' : 'off'}
          autoCapitalize="sentences"
        />
        </div>

        {content.length > MAX_CHARS * 0.8 && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`flex justify-end px-1 py-0.5 text-xs ${
              content.length > MAX_CHARS
                ? 'text-fc-red'
                : content.length > MAX_CHARS * 0.9
                ? 'text-fc-yellow'
                : 'text-fc-muted'
            }`}
          >
            {content.length > MAX_CHARS
              ? <span className="font-medium">{t('hc.mi.over', { n: content.length - MAX_CHARS })}</span>
              : <span>{t('hc.mi.left', { n: MAX_CHARS - content.length })}</span>
            }
          </div>
        )}

        {/* Rangée 2 (mobile) / inline (desktop) : boutons d'action */}
        <div className="flex items-center gap-1 flex-shrink-0 relative ml-auto">
          {/* Bouton Emoji */}
          <div className="relative">
            <button
              onClick={() => { closeAllPickers(); setShowEmojiPicker(p => !p) }}
              className={`p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center rounded transition ${showEmojiPicker ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title="Emoji"
              aria-label="Emoji"
              aria-expanded={showEmojiPicker}
              aria-pressed={showEmojiPicker}
            >
              <SmilePlus size={20} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                serverId={serverId}
                onPick={(emoji) => {
                  const pos = textareaRef.current?.selectionStart ?? content.length
                  setContent(c => c.slice(0, pos) + emoji + c.slice(pos))
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}
          </div>

          {/* Bouton GIF — reste visible sur mobile (les pickers secondaires sont masqués, eux) */}
          <div className="relative">
            <button
              onClick={() => { closeAllPickers(); setShowGifPicker(p => !p) }}
              className={`px-2 py-1 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center rounded transition text-xs font-bold tracking-wide
                ${showGifPicker ? 'text-fc-accent bg-fc-accent/10' : 'text-fc-muted hover:text-white'}`}
              title="GIF"
              aria-label="GIF"
              aria-expanded={showGifPicker}
              aria-pressed={showGifPicker}
            >
              GIF
            </button>
            {showGifPicker && (
              <Suspense fallback={<PickerFallback desktopClassName="absolute bottom-full right-0 mb-2 w-80 h-64 bg-fc-channel border border-fc-hover rounded-xl flex items-center justify-center" />}>
                <GifPicker
                  onPick={handleSendGif}
                  onClose={() => setShowGifPicker(false)}
                />
              </Suspense>
            )}
          </div>

          {/* Bouton Sticker — masqué sur petits écrans */}
          <div className="relative hidden sm:block">
            <button
              onClick={() => { closeAllPickers(); setShowStickerPicker(p => !p) }}
              className={`p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center rounded transition text-base leading-none
                ${showStickerPicker ? 'opacity-100' : 'opacity-50 hover:opacity-100'}`}
              title="Stickers"
              aria-label="Stickers"
              aria-expanded={showStickerPicker}
              aria-pressed={showStickerPicker}
            >
              🎭
            </button>
            {showStickerPicker && (
              <Suspense fallback={<PickerFallback desktopClassName="absolute bottom-full right-0 mb-2 w-72 h-64 bg-fc-channel border border-fc-hover rounded-xl flex items-center justify-center" />}>
                <StickerPicker
                  serverId={serverId || undefined}
                  onPick={handleSendSticker}
                  onClose={() => setShowStickerPicker(false)}
                />
              </Suspense>
            )}
          </div>

          {/* Bouton Quick Replies — masqué sur petits écrans */}
          <div className="relative hidden sm:block">
            <button
              onClick={() => { const next = !showQuickReplies; closeAllPickers(); setShowQuickReplies(next) }}
              className={`p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center rounded transition ${showQuickReplies ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title={t('input.quickReplies')}
              aria-label={t('input.quickReplies')}
              aria-expanded={showQuickReplies}
              aria-pressed={showQuickReplies}
            >
              <Zap size={16} />
            </button>
            {showQuickReplies && (
              <QuickReplies
                onPick={(text) => {
                  const pos = textareaRef.current?.selectionStart ?? content.length
                  setContent(c => c.slice(0, pos) + text + c.slice(pos))
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
                onClose={() => setShowQuickReplies(false)}
              />
            )}
          </div>

          {/* Bouton Messages programmés — masqué sur petits écrans ET en DM :
              scheduled_messages.channel_id référence `channels` (serveur), il
              n'existe aucun équivalent DM sans nouvelle table/migration --
              affiché sans garde jusqu'ici, le clic en DM échouait silencieusement
              (URL /servers//channels/.../scheduled malformée). */}
          {serverId && (
          <div className="relative hidden sm:block">
            <button
              onClick={() => { const next = !showScheduled; closeAllPickers(); setShowScheduled(next) }}
              className={`p-1.5 rounded transition ${showScheduled ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title={t('input.schedule')}
              aria-label={t('input.schedule')}
              aria-expanded={showScheduled}
              aria-pressed={showScheduled}
            >
              <CalendarClock size={20} />
            </button>

            {showScheduled && (
              <PickerShell
                onClose={() => setShowScheduled(false)}
                desktopClassName="absolute bottom-full right-0 mb-2 w-80 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-fc-hover flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <CalendarClock size={14} className="text-fc-accent" />
                    {t('sched.title')}
                  </div>
                  <RouterLink to="/scheduled" onClick={() => setShowScheduled(false)} className="text-xs text-fc-accent hover:underline">
                    {t('sched.seeAll')}
                  </RouterLink>
                </div>

                <div className="p-4 space-y-3">
                  {/* Aperçu du contenu */}
                  {content.trim() && (
                    <div className="bg-fc-input rounded-lg px-3 py-2 text-sm text-fc-muted truncate">
                      {content.trim()}
                    </div>
                  )}
                  {!content.trim() && (
                    <p className="text-xs text-fc-muted">{t('sched.empty')}</p>
                  )}

                  {/* Sélecteur date/heure */}
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    className="w-full fc-input text-sm"
                    aria-label={t('sched.when')}
                  />

                  <button
                    onClick={() => {
                      if (!content.trim()) { toast.error(t('sched.emptyToast')); return }
                      if (!scheduledAt) { toast.error(t('sched.pickDate')); return }
                      createScheduled.mutate({ content: content.trim(), send_at: new Date(scheduledAt).toISOString() })
                    }}
                    disabled={createScheduled.isPending || !content.trim() || !scheduledAt}
                    className="w-full btn-primary text-sm disabled:opacity-40"
                  >
                    {createScheduled.isPending ? t('sched.scheduling') : t('sched.submit')}
                  </button>
                </div>

                {/* Liste des messages programmés */}
                {scheduledMessages.length > 0 && (
                  <div className="border-t border-fc-hover px-4 py-3 space-y-2 max-h-48 overflow-y-auto overscroll-contain">
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                      {t('friends.tab.pending')}
                    </div>
                    {scheduledMessages.map((sm: any) => (
                      <div key={sm.id} className="flex items-start gap-2 bg-fc-bg rounded-lg px-2 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-fc-muted mb-0.5">
                            {formatShortDate(sm.send_at)}
                          </div>
                          <div className="text-sm text-fc-text truncate">{sm.content}</div>
                        </div>
                        <button
                          onClick={() => deleteScheduled.mutate(sm.id)}
                          className="p-1 text-fc-muted hover:text-fc-red rounded transition flex-shrink-0"
                          title={t('common.cancel')}
                          aria-label={t('common.cancel')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </PickerShell>
            )}
          </div>
          )}

          <button
            onClick={() => { closeAllPickers(); void shareLocation() }}
            className="p-1.5 rounded transition text-fc-muted hover:text-white"
            title={t('geo.share')}
            aria-label={t('geo.share')}
          >
            <MapPin size={18} />
          </button>

          {!serverId && (
            <div className="relative">
              <button onClick={() => { closeAllPickers(); setEncPollOpen(o => !o) }} aria-expanded={encPollOpen}
                className={`p-1.5 rounded transition ${encPollOpen ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
                title={t('encpoll.create')} aria-label={t('encpoll.create')}>
                <BarChart3 size={18} />
              </button>
              {encPollOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-72 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50 p-3 space-y-2">
                  <input value={encPollQ} onChange={e => setEncPollQ(e.target.value)} maxLength={300} placeholder={t('encpoll.question')} aria-label={t('encpoll.question')}
                    className="w-full px-2 py-1.5 bg-fc-input rounded text-sm text-white" />
                  <textarea value={encPollOpts} onChange={e => setEncPollOpts(e.target.value)} rows={4} placeholder={t('encpoll.options')} aria-label={t('encpoll.options')}
                    className="w-full px-2 py-1.5 bg-fc-input rounded text-sm text-white" />
                  <label className="flex items-center gap-2 text-xs text-fc-muted">
                    <input type="checkbox" checked={encPollMulti} onChange={e => setEncPollMulti(e.target.checked)} /> {t('encpoll.multi')}
                  </label>
                  <button onClick={() => void sendEncPoll()} className="w-full py-1.5 rounded bg-fc-accent text-white text-sm">{t('encpoll.send')}</button>
                </div>
              )}
            </div>
          )}

          {/* Bouton Sondage — server-only (polls.channel_id référence `channels`),
              masqué sur petits écrans et en DM comme "Programmer un message" ci-dessus */}
          {serverId && (
          <div className="relative hidden sm:block">
            <button
              onClick={() => { const next = !showPollCreator; closeAllPickers(); setShowPollCreator(next) }}
              className={`p-1.5 rounded transition ${showPollCreator ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title={t('input.createPoll')}
              aria-label={t('input.createPoll')}
              aria-expanded={showPollCreator}
              aria-pressed={showPollCreator}
            >
              <BarChart3 size={18} />
            </button>

            {showPollCreator && (
              <PickerShell
                onClose={() => setShowPollCreator(false)}
                desktopClassName="absolute bottom-full right-0 mb-2 w-80 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-fc-hover">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <BarChart3 size={14} className="text-fc-accent" />
                    {t('poll.title')}
                  </div>
                </div>

                <div className="p-4 space-y-3 max-h-96 overflow-y-auto overscroll-contain">
                  <input
                    value={pollQuestion}
                    onChange={e => setPollQuestion(e.target.value)}
                    placeholder={t('poll.question')}
                    aria-label={t('poll.question')}
                    maxLength={300}
                    className="w-full fc-input text-sm"
                  />

                  <div className="space-y-2">
                    {pollOptions.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={opt}
                          onChange={e => setPollOptions(prev => prev.map((o, idx) => idx === i ? e.target.value : o))}
                          placeholder={t('poll.option', { n: i + 1 })}
                          aria-label={t('poll.option', { n: i + 1 })}
                          maxLength={100}
                          className="flex-1 fc-input text-sm"
                        />
                        {pollOptions.length > 2 && (
                          <button
                            onClick={() => setPollOptions(prev => prev.filter((_, idx) => idx !== i))}
                            className="p-1 text-fc-muted hover:text-fc-red rounded transition flex-shrink-0"
                            title={t('poll.removeOption')}
                            aria-label={t('poll.removeOption')}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {pollOptions.length < 10 && (
                      <button
                        onClick={() => setPollOptions(prev => [...prev, ''])}
                        className="text-xs text-fc-accent hover:underline"
                      >
                        {t('poll.addOption')}
                      </button>
                    )}
                  </div>

                  <label className="flex items-center gap-2 text-sm text-fc-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pollMultiple}
                      onChange={e => setPollMultiple(e.target.checked)}
                      className="accent-fc-accent"
                    />
                    {t('poll.multiple')}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-fc-muted cursor-pointer">
                    <input type="checkbox" checked={pollAnonymous} onChange={e => setPollAnonymous(e.target.checked)} className="accent-fc-accent" />
                    {t('poll.anonymous')}
                  </label>
                  <label className="block text-xs text-fc-muted">
                    {t('poll.deadline')}
                    <input type="datetime-local" value={pollEndsAt} onChange={e => setPollEndsAt(e.target.value)}
                      min={new Date(Date.now() + 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
                      className="mt-1 w-full fc-input text-sm" />
                  </label>

                  <button
                    onClick={() => {
                      const validOptions = pollOptions.map(o => o.trim()).filter(Boolean)
                      if (!pollQuestion.trim()) { toast.error(t('poll.questionRequired')); return }
                      if (validOptions.length < 2) { toast.error(t('poll.twoOptions')); return }
                      if (pollEndsAt && new Date(pollEndsAt).getTime() <= Date.now()) { toast.error(t('poll.deadlineInvalid')); return }
                      createPoll.mutate()
                    }}
                    disabled={createPoll.isPending || !pollQuestion.trim()}
                    className="w-full btn-primary text-sm disabled:opacity-40"
                  >
                    {createPoll.isPending ? t('common.creating') : t('poll.submit')}
                  </button>
                </div>
              </PickerShell>
            )}
          </div>
          )}

          {/* TTL message éphémère — masqué sur petits écrans, et hors salon : le serveur ne gère
              expires_at que dans les salons (en MP/groupe le message partait sans expiration). */}
          {serverId && <div className="relative hidden sm:block">
            <button
              onClick={() => { setShowTtlPicker(v => !v) }}
              className={`p-1.5 rounded transition ${msgTtl ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title={msgTtl ? t('input.ephemeralIs', { ttl: t(MSG_TTL_OPTIONS.find(o => o.value === msgTtl)?.label ?? 'input.ttl.none') }) : t('input.ephemeral')}
              aria-label={msgTtl ? t('input.ephemeralActive', { ttl: t(MSG_TTL_OPTIONS.find(o => o.value === msgTtl)?.label ?? 'input.ttl.none') }) : t('input.ephemeral')}
              aria-pressed={!!msgTtl}
              aria-expanded={showTtlPicker}
            >
              <Clock size={18} />
            </button>
            {showTtlPicker && (
              <PickerShell
                onClose={() => setShowTtlPicker(false)}
                desktopClassName="absolute bottom-full right-0 mb-2 w-48 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50 overflow-hidden"
              >
                <div className="px-3 py-2 border-b border-fc-hover text-xs font-semibold text-fc-muted uppercase">
                  {t('input.expiration')}
                </div>
                {MSG_TTL_OPTIONS.map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => { setMsgTtl(opt.value); setShowTtlPicker(false) }}
                    className={`w-full text-left px-3 py-2 min-h-[40px] text-sm transition hover:bg-fc-hover ${
                      msgTtl === opt.value ? 'text-fc-accent' : 'text-fc-text'
                    }`}
                  >
                    {t(opt.label)}
                    {msgTtl === opt.value && ' ✓'}
                  </button>
                ))}
              </PickerShell>
            )}
          </div>}

          {/* Voice message — disponible aussi en DM, cf. handleVoiceMessage */}
          {showVoiceRecorder ? (
            <div className="absolute bottom-full left-0 right-0 mb-2 px-2">
              <VoiceMessageRecorder
                onSend={handleVoiceMessage}
                onCancel={() => setShowVoiceRecorder(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setShowVoiceRecorder(true)}
              className="p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center text-fc-muted hover:text-fc-accent rounded transition"
              title={t('input.voiceTitle')}
              aria-label={t('input.voice')}
            >
              <Mic size={18} />
            </button>
          )}

          <button
            onClick={submit}
            disabled={(!content.trim() && files.length === 0) || content.length > MAX_CHARS || !!sending}
            className="p-2.5 md:p-1.5 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center text-fc-muted hover:text-fc-accent rounded transition disabled:opacity-30"
            title={t('input.sendTitle')}
            aria-label={t('input.send')}
          >
            <Send size={20} />
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
