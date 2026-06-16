import { useRef, useState, useEffect } from 'react'
import { Plus, SmilePlus, Send } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { useQuery } from '@tanstack/react-query'
import { useWs } from '../../store/ws'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  channelId: string
  serverId: string
  placeholder?: string
  onSend: (content: string) => void
}

interface MentionUser {
  id: string
  username: string
  avatar?: string | null
  discriminator: string
}

export default function MessageInput({ channelId, serverId, placeholder, onSend }: Props) {
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [showMentions, setShowMentions] = useState(false)
  const [cursorPos, setCursorPos] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { send } = useWs()
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>()

  const { data: mentionResults = [] } = useQuery<MentionUser[]>({
    queryKey: ['mention_search', mentionQuery],
    queryFn: () =>
      api.get(`/users/search?q=${encodeURIComponent(mentionQuery)}`).then(r => r.data),
    enabled: showMentions && mentionQuery.length >= 1,
  })

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => setFiles(prev => [...prev, ...accepted]),
  })

  const detectMention = (value: string, pos: number) => {
    const before = value.slice(0, pos)
    const match = before.match(/@(\w*)$/)
    if (match) {
      setMentionQuery(match[1])
      setMentionIndex(0)
      setShowMentions(true)
    } else {
      setShowMentions(false)
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || e.key === 'Enter' && showMentions) {
        e.preventDefault()
        insertMention(mentionResults[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        setShowMentions(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart ?? 0
    setContent(val)
    setCursorPos(pos)
    detectMention(val, pos)

    send({ type: 'TYPING_START', channel_id: channelId })
    clearTimeout(typingTimeout.current)
    typingTimeout.current = setTimeout(() => {}, 3000)
  }

  const submit = () => {
    const trimmed = content.trim()
    if (!trimmed && files.length === 0) return
    if (trimmed) onSend(trimmed)
    setContent('')
    setFiles([])
    setShowMentions(false)
    textareaRef.current?.focus()
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 144) + 'px'
    }
  }, [content])

  return (
    <div {...getRootProps()} className={`px-4 pb-4 relative ${isDragActive ? 'ring-2 ring-fc-accent ring-inset' : ''}`}>
      <input {...getInputProps()} />

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
                {user.avatar
                  ? <img src={user.avatar} alt="" className="w-full h-full object-cover" />
                  : user.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-medium">{user.username}</div>
                <div className="text-xs text-fc-muted">#{user.discriminator}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Aperçu fichiers */}
      {files.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-1 bg-fc-input px-2 py-1 rounded text-sm">
              <span className="text-fc-text truncate max-w-32">{f.name}</span>
              <button
                onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}
                className="text-fc-muted hover:text-fc-red ml-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 bg-fc-input rounded-lg px-2 py-2">
        <button
          onClick={open}
          className="p-1.5 text-fc-muted hover:text-white rounded transition flex-shrink-0"
          title="Joindre un fichier"
        >
          <Plus size={20} />
        </button>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? 'Envoyer un message...'}
          rows={1}
          className="flex-1 bg-transparent text-fc-text placeholder-fc-muted outline-none resize-none text-sm overflow-y-hidden"
          style={{ lineHeight: '1.5', minHeight: '24px', maxHeight: '144px' }}
        />

        <div className="flex items-center gap-1 flex-shrink-0">
          <button className="p-1.5 text-fc-muted hover:text-white rounded transition" title="Emoji">
            <SmilePlus size={20} />
          </button>
          <button
            onClick={submit}
            disabled={!content.trim() && files.length === 0}
            className="p-1.5 text-fc-muted hover:text-fc-accent rounded transition disabled:opacity-30"
            title="Envoyer"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
