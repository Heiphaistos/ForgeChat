import { useRef, useState, useEffect, useCallback } from 'react'
import {
  Plus, SmilePlus, Send, X, CornerUpLeft, Clock, Image, Film, File, Trash2, CalendarClock, Slash,
  Bold, Italic, Strikethrough, Code, Terminal, Quote, Link, Mic, Zap,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWs } from '../../store/ws'
import api from '../../api/client'
import toast from 'react-hot-toast'
import EmojiPicker from './EmojiPicker'
import GifPicker from './GifPicker'
import StickerPicker, { formatStickerMessage } from './StickerPicker'
import type { Sticker } from './StickerPicker'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import VoiceMessageRecorder from './VoiceMessageRecorder'
import QuickReplies from './QuickReplies'

// ─── Slash Commands ───────────────────────────────────────────────────────────

const MAX_CHARS = 4000

const MSG_TTL_OPTIONS = [
  { label: 'Aucune expiration', value: null },
  { label: '5 minutes', value: 300 },
  { label: '1 heure', value: 3600 },
  { label: '24 heures', value: 86400 },
  { label: '7 jours', value: 604800 },
]

interface SlashCommand {
  name: string
  description: string
  usage: string
  isBot?: boolean
  botName?: string
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: 'me', description: 'Envoie une action en italique', usage: '/me [texte]' },
  { name: 'shrug', description: 'Envoie ¯\\_(ツ)_/¯', usage: '/shrug' },
  { name: 'tableflip', description: 'Table flip !', usage: '/tableflip' },
  { name: 'unflip', description: 'Remet la table', usage: '/unflip' },
  { name: 'lenny', description: 'Visage Lenny', usage: '/lenny' },
  { name: 'clap', description: 'Applaudissements 👏 entre les mots', usage: '/clap [texte]' },
  { name: 'spoiler', description: 'Cache le texte en spoiler', usage: '/spoiler [texte]' },
  { name: 'giphy', description: 'Cherche un GIF avec Giphy', usage: '/giphy [query]' },
]

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
  serverId: string
  placeholder?: string
  onSend: (content: string, replyTo?: string, files?: FileWithTtl[], ttlSeconds?: number | null) => void
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

interface ChannelItem {
  id: string
  name: string
  type: string
}

const TTL_OPTIONS = [
  { label: 'Ne pas expirer', value: null },
  { label: '1 heure', value: 1 },
  { label: '24 heures', value: 24 },
  { label: '7 jours', value: 168 },
  { label: '30 jours', value: 720 },
]

function isVideo(file: File) { return file.type.startsWith('video/') }
function isImage(file: File) { return file.type.startsWith('image/') }

function FileIcon({ file }: { file: File }) {
  if (isImage(file)) return <Image size={14} className="text-blue-400" />
  if (isVideo(file)) return <Film size={14} className="text-purple-400" />
  return <File size={14} className="text-fc-muted" />
}

export default function MessageInput({ channelId, serverId, placeholder, onSend, replyTo, onCancelReply, sending }: Props) {
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<FileWithTtl[]>([])
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
  const [cursorPos, setCursorPos] = useState(0)
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false)
  const [msgTtl, setMsgTtl] = useState<number | null>(null)
  const [showTtlPicker, setShowTtlPicker] = useState(false)
  // Slash commands
  const [showSlash, setShowSlash] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashIndex, setSlashIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { send } = useWs()
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>()
  const queryClient = useQueryClient()

  const { data: mentionResults = [] } = useQuery<MentionUser[]>({
    queryKey: ['mention_search', mentionQuery],
    queryFn: () =>
      api.get(`/users/search?q=${encodeURIComponent(mentionQuery)}`).then(r => r.data),
    enabled: showMentions && mentionQuery.length >= 1,
  })

  const { data: allServerChannels = [] } = useQuery<ChannelItem[]>({
    queryKey: ['server_channels_list', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data.channels ?? []),
    enabled: !!serverId,
    staleTime: 30_000,
  })

  const channelResults = channelQuery
    ? allServerChannels.filter(c => c.name.toLowerCase().includes(channelQuery.toLowerCase())).slice(0, 5)
    : allServerChannels.slice(0, 5)

  const { data: botCommandsRaw = [] } = useQuery<{ name: string; description: string; bot_name: string }[]>({
    queryKey: ['server_commands', serverId],
    queryFn: () => api.get(`/servers/${serverId}/commands`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  // Fusion builtin + bot commands
  const allSlashCommands: SlashCommand[] = [
    ...BUILTIN_COMMANDS,
    ...botCommandsRaw.map(bc => ({
      name: bc.name,
      description: bc.description,
      usage: `/${bc.name}`,
      isBot: true,
      botName: bc.bot_name,
    })),
  ]

  const filteredSlashCommands = slashQuery
    ? allSlashCommands.filter(c => c.name.startsWith(slashQuery.toLowerCase()))
    : allSlashCommands

  const { data: scheduledMessages = [] } = useQuery<any[]>({
    queryKey: ['scheduled_messages', serverId, channelId],
    queryFn: () =>
      api.get(`/servers/${serverId}/channels/${channelId}/scheduled`).then(r => r.data),
    enabled: showScheduled,
    staleTime: 15_000,
  })

  const createScheduled = useMutation({
    mutationFn: ({ content, send_at }: { content: string; send_at: string }) =>
      api.post(`/servers/${serverId}/channels/${channelId}/scheduled`, { content, send_at }),
    onSuccess: () => {
      toast.success('Message programmé')
      setScheduledAt('')
      setContent('')
      queryClient.invalidateQueries({ queryKey: ['scheduled_messages', serverId, channelId] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Erreur'),
  })

  const deleteScheduled = useMutation({
    mutationFn: (id: string) => api.delete(`/scheduled/${id}`),
    onSuccess: () => {
      toast.success('Message annulé')
      queryClient.invalidateQueries({ queryKey: ['scheduled_messages', serverId, channelId] })
    },
    onError: () => toast.error('Impossible d\'annuler'),
  })

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => addFiles(accepted),
  })

  const addFiles = useCallback((newFiles: File[]) => {
    const wrapped: FileWithTtl[] = newFiles.map(f => ({
      file: f,
      ttlHours: isVideo(f) ? 24 : null,
      preview: isImage(f) ? URL.createObjectURL(f) : null,
    }))
    setFiles(prev => [...prev, ...wrapped])
  }, [])

  // Coller image depuis le presse-papiers
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageItems = Array.from(items).filter(i => i.type.startsWith('image/'))
      if (imageItems.length === 0) return
      const filesFromClipboard = imageItems.map(i => i.getAsFile()).filter(Boolean) as File[]
      if (filesFromClipboard.length > 0) {
        e.preventDefault()
        addFiles(filesFromClipboard)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [addFiles])

  // Libérer les URLs de preview
  useEffect(() => {
    return () => {
      files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview) })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
          setFiles([])
        })
        if (executed) {
          setContent('')
          setShowSlash(false)
        }
      }
    }
  }

  const insertMention = (user: MentionUser) => {
    const pos = cursorPos
    const before = content.slice(0, pos)
    const after = content.slice(pos)
    const atIdx = before.lastIndexOf('@')
    const newContent = before.slice(0, atIdx) + `@${user.username} ` + after
    setContent(newContent)
    setShowMentions(false)
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = atIdx + user.username.length + 2
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
    const selected = content.slice(ta.selectionStart, ta.selectionEnd) || 'texte'
    const url = window.prompt('URL du lien :', 'https://')
    if (!url) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const newContent = content.slice(0, start) + `[${selected}](${url})` + content.slice(end)
    setContent(newContent)
    setTimeout(() => ta.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    if (showMentions && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && showMentions)) { e.preventDefault(); insertMention(mentionResults[mentionIndex]); return }
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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart ?? 0
    setContent(val)
    setCursorPos(pos)
    detectMention(val, pos)
    detectSlash(val)
    send({ type: 'TYPING_START', channel_id: channelId })
    clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => {}, 3000)
  }

  const submit = () => {
    const trimmed = content.trim()
    if (!trimmed && files.length === 0) return

    // Essai d'exécution slash command built-in
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(' ')
      const cmdName = parts[0].toLowerCase()
      const args = parts.slice(1).join(' ')
      const isBuiltin = BUILTIN_COMMANDS.some(c => c.name === cmdName)
      if (isBuiltin) {
        const executed = executeSlashCommand(cmdName, args, setContent, setShowGifPicker, (msg) => {
          onSend(msg, replyTo?.id)
          onCancelReply?.()
        })
        if (executed) {
          setContent('')
          setFiles([])
          setShowSlash(false)
          setShowMentions(false)
          textareaRef.current?.focus()
          return
        }
      }
      // Sinon : c'est peut-être une bot command, on envoie le message tel quel
    }

    onSend(trimmed, replyTo?.id, files.length > 0 ? files : undefined, msgTtl)
    setContent('')
    setFiles([])
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
      const res = await api.post(`/servers/${serverId}/channels/${channelId}/messages`, {
        content: `🎤 Message vocal (${durationStr})`,
      })
      const formData = new FormData()
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
      formData.append('file', blob, `voice-${Date.now()}.${ext}`)
      await api.post(`/servers/${serverId}/channels/${channelId}/messages/${res.data.id}/attachments`, formData)
      setShowVoiceRecorder(false)
    } catch {
      toast.error("Erreur lors de l'envoi du message vocal")
      setShowVoiceRecorder(false)
    }
  }, [channelId, serverId])

  const closeAllPickers = () => {
    setShowEmojiPicker(false)
    setShowGifPicker(false)
    setShowStickerPicker(false)
    setShowScheduled(false)
    setShowQuickReplies(false)
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 144) + 'px'
    }
  }, [content])

  const hasVideos = files.some(f => isVideo(f.file))

  return (
    <div {...getRootProps()} className={`px-4 pb-4 relative ${isDragActive ? 'ring-2 ring-fc-accent ring-inset rounded-lg' : ''}`}>
      <input {...getInputProps()} />

      {/* Barre de réponse */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-fc-input/60 rounded-t-lg border-b border-fc-hover text-xs">
          <CornerUpLeft size={12} className="text-fc-accent flex-shrink-0" />
          <span className="text-fc-muted">Réponse à</span>
          <span className="font-semibold text-white">{replyTo.author_username}</span>
          {replyTo.content && (
            <span className="text-fc-muted truncate max-w-xs">{replyTo.content.slice(0, 80)}</span>
          )}
          <button onClick={onCancelReply} className="ml-auto p-0.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition" title="Annuler">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Dropdown slash commands */}
      {showSlash && filteredSlashCommands.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto">
          <div className="px-3 py-1.5 text-xs font-semibold text-fc-muted uppercase tracking-wide border-b border-fc-hover flex items-center gap-1.5">
            <Slash size={10} />
            Commandes{slashQuery ? ` — /${slashQuery}` : ''}
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
                </div>
                <div className="text-xs text-fc-muted truncate">{cmd.description}</div>
              </div>
              <div className="text-xs text-fc-muted/60 flex-shrink-0 hidden sm:block">{cmd.usage}</div>
            </button>
          ))}
        </div>
      )}

      {/* Dropdown mentions */}
      {showMentions && mentionResults.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50 max-h-52 overflow-y-auto">
          <div className="px-3 py-1.5 text-xs font-semibold text-fc-muted uppercase tracking-wide border-b border-fc-hover">
            Membres — @{mentionQuery}
          </div>
          {mentionResults.map((user, idx) => (
            <button
              key={user.id}
              onClick={() => insertMention(user)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition
                ${idx === mentionIndex ? 'bg-fc-accent/20 text-white' : 'text-fc-text hover:bg-fc-hover'}`}
            >
              <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 overflow-hidden">
                {user.avatar ? <img src={user.avatar} alt="" className="w-full h-full object-cover" /> : user.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-medium">{user.username}</div>
                <div className="text-xs text-fc-muted">#{user.discriminator}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Dropdown channels # */}
      {showChannels && channelResults.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-fc-channel border border-fc-hover rounded-lg shadow-2xl overflow-hidden z-50 max-h-52 overflow-y-auto">
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

      {/* Aperçu fichiers */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap p-2 bg-fc-input/40 rounded-lg border border-fc-hover">
          {files.map((fw, i) => (
            <div key={i} className="relative group flex flex-col gap-1">
              {/* Preview image */}
              {fw.preview ? (
                <div className="w-20 h-20 rounded overflow-hidden border border-fc-hover flex-shrink-0">
                  <img src={fw.preview} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded border border-fc-hover bg-fc-bg flex flex-col items-center justify-center gap-1 text-center">
                  <FileIcon file={fw.file} />
                  <span className="text-xs text-fc-muted truncate w-16 text-center px-1">{fw.file.name}</span>
                </div>
              )}

              {/* TTL selector pour vidéos */}
              {isVideo(fw.file) && (
                <select
                  value={fw.ttlHours ?? ''}
                  onChange={e => updateTtl(i, e.target.value ? Number(e.target.value) : null)}
                  className="text-xs bg-fc-bg border border-fc-hover rounded px-1 py-0.5 text-fc-muted w-20"
                  title="Durée de vie"
                >
                  {TTL_OPTIONS.map(o => (
                    <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>
                  ))}
                </select>
              )}

              {/* Bouton supprimer */}
              <button
                onClick={() => removeFile(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-fc-red rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition"
              >
                <X size={8} />
              </button>
            </div>
          ))}

          {hasVideos && (
            <div className="flex items-center gap-1 text-xs text-fc-muted self-start mt-1">
              <Clock size={10} />
              <span>TTL vidéos configuré par fichier</span>
            </div>
          )}
        </div>
      )}

      {/* Indicateur drag */}
      {isDragActive && (
        <div className="absolute inset-0 bg-fc-accent/10 border-2 border-dashed border-fc-accent rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <span className="text-fc-accent font-semibold text-sm">Déposer les fichiers ici</span>
        </div>
      )}

      <div className="bg-fc-input rounded-lg">
        {/* Barre Rich Text */}
        <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-fc-hover">
          <button onClick={() => applyFormat('**')} title="Gras (Ctrl+B)" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Bold size={13} /></button>
          <button onClick={() => applyFormat('*')} title="Italique (Ctrl+I)" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Italic size={13} /></button>
          <button onClick={() => applyFormat('~~')} title="Barré" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Strikethrough size={13} /></button>
          <div className="w-px h-4 bg-fc-hover mx-0.5" />
          <button onClick={() => applyFormat('`')} title="Code inline" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Code size={13} /></button>
          <button onClick={() => applyFormat('```\n', '\n```')} title="Bloc de code" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Terminal size={13} /></button>
          <button onClick={() => applyFormat('> ', '')} title="Citation" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Quote size={13} /></button>
          <div className="w-px h-4 bg-fc-hover mx-0.5" />
          <button onClick={insertLink} title="Lien (Ctrl+K)" className="p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition"><Link size={13} /></button>
        </div>

        <div className="flex items-end gap-2 px-2 py-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-1.5 text-fc-muted hover:text-white rounded transition flex-shrink-0"
          title="Joindre un fichier"
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
          placeholder={placeholder ?? 'Envoyer un message...'}
          rows={1}
          className="flex-1 bg-transparent text-fc-text placeholder-fc-muted outline-none resize-none text-sm overflow-y-hidden"
          style={{ lineHeight: '1.5', minHeight: '24px', maxHeight: '144px' }}
        />

        {content.length > MAX_CHARS * 0.8 && (
          <div className={`flex justify-end px-1 py-0.5 text-xs ${
            content.length > MAX_CHARS
              ? 'text-fc-red'
              : content.length > MAX_CHARS * 0.9
              ? 'text-fc-yellow'
              : 'text-fc-muted'
          }`}>
            {content.length > MAX_CHARS
              ? <span className="font-medium">{content.length - MAX_CHARS} caractère{content.length - MAX_CHARS > 1 ? 's' : ''} en trop</span>
              : <span>{MAX_CHARS - content.length} restant{MAX_CHARS - content.length > 1 ? 's' : ''}</span>
            }
          </div>
        )}

        <div className="flex items-center gap-1 flex-shrink-0 relative">
          {/* Bouton Emoji */}
          <div className="relative">
            <button
              onClick={() => { closeAllPickers(); setShowEmojiPicker(p => !p) }}
              className={`p-1.5 rounded transition ${showEmojiPicker ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title="Emoji"
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

          {/* Bouton GIF */}
          <div className="relative">
            <button
              onClick={() => { closeAllPickers(); setShowGifPicker(p => !p) }}
              className={`px-2 py-1 rounded transition text-xs font-bold tracking-wide
                ${showGifPicker ? 'text-fc-accent bg-fc-accent/10' : 'text-fc-muted hover:text-white'}`}
              title="GIF"
            >
              GIF
            </button>
            {showGifPicker && (
              <GifPicker
                onPick={handleSendGif}
                onClose={() => setShowGifPicker(false)}
              />
            )}
          </div>

          {/* Bouton Sticker */}
          <div className="relative">
            <button
              onClick={() => { closeAllPickers(); setShowStickerPicker(p => !p) }}
              className={`p-1.5 rounded transition text-base leading-none
                ${showStickerPicker ? 'opacity-100' : 'opacity-50 hover:opacity-100'}`}
              title="Stickers"
            >
              🎭
            </button>
            {showStickerPicker && (
              <StickerPicker
                serverId={serverId || undefined}
                onPick={handleSendSticker}
                onClose={() => setShowStickerPicker(false)}
              />
            )}
          </div>

          {/* Bouton Quick Replies */}
          <div className="relative">
            <button
              onClick={() => { const next = !showQuickReplies; closeAllPickers(); setShowQuickReplies(next) }}
              className={`p-1.5 rounded transition ${showQuickReplies ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title="Réponses rapides"
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

          {/* Bouton Messages programmés */}
          <div className="relative">
            <button
              onClick={() => { const next = !showScheduled; closeAllPickers(); setShowScheduled(next) }}
              className={`p-1.5 rounded transition ${showScheduled ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title="Programmer un message"
            >
              <CalendarClock size={20} />
            </button>

            {showScheduled && (
              <div
                className="absolute bottom-full right-0 mb-2 w-80 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50 overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-fc-hover">
                  <div className="text-sm font-semibold text-white flex items-center gap-2">
                    <CalendarClock size={14} className="text-fc-accent" />
                    Programmer un message
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {/* Aperçu du contenu */}
                  {content.trim() && (
                    <div className="bg-fc-input rounded-lg px-3 py-2 text-sm text-fc-muted truncate">
                      {content.trim()}
                    </div>
                  )}
                  {!content.trim() && (
                    <p className="text-xs text-fc-muted">Écris un message dans l'input avant de programmer.</p>
                  )}

                  {/* Sélecteur date/heure */}
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                    className="w-full fc-input text-sm"
                  />

                  <button
                    onClick={() => {
                      if (!content.trim()) { toast.error('Message vide'); return }
                      if (!scheduledAt) { toast.error('Choisir une date'); return }
                      createScheduled.mutate({ content: content.trim(), send_at: new Date(scheduledAt).toISOString() })
                    }}
                    disabled={createScheduled.isPending || !content.trim() || !scheduledAt}
                    className="w-full btn-primary text-sm disabled:opacity-40"
                  >
                    {createScheduled.isPending ? 'Programmation...' : 'Programmer'}
                  </button>
                </div>

                {/* Liste des messages programmés */}
                {scheduledMessages.length > 0 && (
                  <div className="border-t border-fc-hover px-4 py-3 space-y-2 max-h-48 overflow-y-auto">
                    <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide mb-1">
                      En attente
                    </div>
                    {scheduledMessages.map((sm: any) => (
                      <div key={sm.id} className="flex items-start gap-2 bg-fc-bg rounded-lg px-2 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-fc-muted mb-0.5">
                            {format(new Date(sm.send_at), "dd/MM 'à' HH:mm", { locale: fr })}
                          </div>
                          <div className="text-sm text-fc-text truncate">{sm.content}</div>
                        </div>
                        <button
                          onClick={() => deleteScheduled.mutate(sm.id)}
                          className="p-1 text-fc-muted hover:text-fc-red rounded transition flex-shrink-0"
                          title="Annuler"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* TTL message éphémère */}
          <div className="relative">
            <button
              onClick={() => { setShowTtlPicker(v => !v) }}
              className={`p-1.5 rounded transition ${msgTtl ? 'text-fc-accent' : 'text-fc-muted hover:text-white'}`}
              title={msgTtl ? `Message éphémère : ${MSG_TTL_OPTIONS.find(o => o.value === msgTtl)?.label}` : 'Message éphémère'}
            >
              <Clock size={18} />
            </button>
            {showTtlPicker && (
              <div className="absolute bottom-full right-0 mb-2 w-48 bg-fc-channel border border-fc-hover rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-fc-hover text-xs font-semibold text-fc-muted uppercase">
                  Expiration du message
                </div>
                {MSG_TTL_OPTIONS.map(opt => (
                  <button
                    key={String(opt.value)}
                    onClick={() => { setMsgTtl(opt.value); setShowTtlPicker(false) }}
                    className={`w-full text-left px-3 py-2 text-sm transition hover:bg-fc-hover ${
                      msgTtl === opt.value ? 'text-fc-accent' : 'text-fc-text'
                    }`}
                  >
                    {opt.label}
                    {msgTtl === opt.value && ' ✓'}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Voice message */}
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
              className="p-1.5 text-fc-muted hover:text-fc-accent rounded transition"
              title="Message vocal"
            >
              <Mic size={18} />
            </button>
          )}

          <button
            onClick={submit}
            disabled={(!content.trim() && files.length === 0) || content.length > MAX_CHARS || !!sending}
            className="p-1.5 text-fc-muted hover:text-fc-accent rounded transition disabled:opacity-30"
            title="Envoyer"
          >
            <Send size={20} />
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
