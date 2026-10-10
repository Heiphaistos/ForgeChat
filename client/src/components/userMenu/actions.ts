// Actions des menus utilisateur partagées hors React (zone de saisie, MP, invitation).
import api from '../../api/client'
import { withSeal } from '../../e2e/conversations'

/** Ouvre (ou crée) la conversation privée avec `userId` et renvoie son id. */
export async function dmWith(userId: string): Promise<string> {
  const { data } = await api.post<{ dm_id: string }>(`/dms/${userId}`)
  return data.dm_id
}

/** Insère @pseudo dans la zone de saisie ouverte, avec le jeton <@id> qui notifie (MessageInput). */
export function insertMention(userId: string, username: string): boolean {
  const el = document.querySelector<HTMLTextAreaElement>('textarea[data-message-input]')
  if (!el) return false
  const pos = el.selectionStart ?? el.value.length
  window.dispatchEvent(new CustomEvent('forgechat:mention-picked', { detail: { name: username, token: `<@${userId}>` } }))
  const mention = `@${username} `
  el.focus()
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    ?.call(el, el.value.slice(0, pos) + mention + el.value.slice(pos))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  const next = pos + mention.length
  setTimeout(() => el.setSelectionRange(next, next), 0)
  return true
}

export const hasComposer = () => !!document.querySelector('textarea[data-message-input]')

/** Crée une invitation (7 jours) et l'envoie, chiffrée, dans le MP de la personne. */
export async function inviteToServer(serverId: string, userId: string): Promise<void> {
  const { data } = await api.post<{ code: string }>(`/servers/${serverId}/invites`, { max_uses: null, expires_hours: 168 })
  const dmId = await dmWith(userId)
  const url = `${window.location.origin}/invite/${data.code}`
  await withSeal('dm', dmId, url, body => api.post(`/dms/${dmId}/messages`, { ...body, content: body.content ?? '' }))
}
