import { useRef, useState } from 'react'
import { Plus, SmilePlus, Send } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { useWs } from '../../store/ws'
import api from '../../api/client'
import toast from 'react-hot-toast'

interface Props {
  channelId: string
  serverId: string
  placeholder?: string
  onSend: (content: string) => void
  onUpload?: (msgId: string, files: File[]) => void
}

export default function MessageInput({ channelId, serverId, placeholder, onSend }: Props) {
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { send } = useWs()
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>()

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: (accepted) => setFiles(prev => [...prev, ...accepted]),
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)

    // Typing indicator
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
    textareaRef.current?.focus()
  }

  return (
    <div {...getRootProps()} className={`px-4 pb-4 ${isDragActive ? 'ring-2 ring-fc-accent ring-inset' : ''}`}>
      <input {...getInputProps()} />

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
          placeholder={placeholder ?? `Envoyer un message...`}
          rows={1}
          className="flex-1 bg-transparent text-fc-text placeholder-fc-muted outline-none resize-none text-sm max-h-36 overflow-y-auto"
          style={{ lineHeight: '1.5' }}
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
