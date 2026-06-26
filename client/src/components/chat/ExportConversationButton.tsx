import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'

interface ExportConversationButtonProps {
  channelId: string
  channelName: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${y}-${mo}-${day} ${h}:${mi}`
}

export default function ExportConversationButton({ channelId, channelName }: ExportConversationButtonProps) {
  const qc = useQueryClient()

  const handleExport = () => {
    const messages: any[] = qc.getQueryData(['messages', channelId]) ?? []

    if (messages.length === 0) {
      toast.error('Aucun message à exporter')
      return
    }

    // Trier du plus ancien au plus récent
    const sorted = [...messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )

    const lines: string[] = [
      `# Conversation — #${channelName}`,
      `# Exporté le ${formatDate(new Date().toISOString())}`,
      `# ${sorted.length} message(s)`,
      '',
    ]

    for (const msg of sorted) {
      const date = formatDate(msg.created_at)
      const author = msg.author_username ?? 'inconnu'
      const content = msg.content ?? ''

      if (content) {
        lines.push(`[${date}] ${author}: ${content}`)
      }

      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          lines.push(`[${date}] ${author}: [Pièce jointe: ${att.filename ?? att.url}]`)
        }
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `forgechat-${channelName}-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success(`${sorted.length} messages exportés`)
  }

  return (
    <button
      onClick={handleExport}
      className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover"
      title="Exporter la conversation"
    >
      <Download size={18} />
    </button>
  )
}
