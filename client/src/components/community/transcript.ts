// Transcription d'un ticket : l'historique CHIFFRÉ du salon est relu et déchiffré sur
// l'appareil, puis enregistré en texte. Rien de déchiffré ne repart au serveur.
import api from '../../api/client'
import { openMessages } from '../../e2e/conversations'
import { displayAttachments } from '../../e2e/files'
import { downloadText } from './format'

const MAX_PAGES = 50

export async function exportTranscript(serverId: string, channelId: string, title: string): Promise<number> {
  const all: any[] = []
  let before: string | undefined
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data } = await api.get<any[]>(`/servers/${serverId}/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`)
    if (!data.length) break
    all.unshift(...data)
    before = data[0].id
    if (data.length < 100) break
  }
  const opened = await openMessages('channel', channelId, all)
  const lines = [`# ${title}`, `# ${new Date().toISOString()}`, '']
  for (const m of opened) {
    const at = new Date(m.created_at).toISOString().replace('T', ' ').slice(0, 16)
    if (m.content) lines.push(`[${at}] ${m.author_username ?? '?'} : ${m.content}`)
    for (const a of displayAttachments(m.attachments ?? [], m.e2e_body)) lines.push(`[${at}] ${m.author_username ?? '?'} : [${a.filename ?? a.url}]`)
  }
  downloadText(`${title.replace(/[^\p{L}\p{N}-]+/gu, '-')}.txt`, lines.join('\n'), 'text/plain')
  return opened.length
}
