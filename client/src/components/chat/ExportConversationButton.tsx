import { useChat } from '../../store/chat'
import { Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { displayAttachments } from '../../e2e/files'
import { saveFile } from '../../lib/saveFile'
import { isDesktop } from '../../lib/desktop'

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
  const messages = useChat(s => s.messagesByChannel[channelId] ?? [])

  const handleExport = async () => {
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
        // Fichier chiffré : son vrai nom vient du message déchiffré (le fichier reste sur le serveur, chiffré).
        for (const att of displayAttachments(msg.attachments, msg.e2e_body)) {
          lines.push(`[${date}] ${author}: [Pièce jointe: ${att.filename ?? att.url}]`)
        }
      }
    }

    const name = `forgechat-${channelName}-${new Date().toISOString().slice(0, 10)}.txt`
    // Bureau : saveFile affiche lui-même « Enregistré dans … ».
    if (await saveFile(lines.join('\n'), name, 'text/plain') && !isDesktop) {
      toast.success(`${sorted.length} messages exportés`)
    }
  }

  return (
    <button
      onClick={() => void handleExport()}
      aria-label={`Exporter la conversation #${channelName} en fichier texte`}
      className="p-1.5 text-fc-muted hover:text-white transition rounded hover:bg-fc-hover"
    >
      <Download size={18} aria-hidden />
    </button>
  )
}
