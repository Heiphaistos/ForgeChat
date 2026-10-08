// Messages d'un MP lus depuis le serveur et déchiffrés sur l'appareil. Partagé par DMPage et le
// préchargement au survol de la liste des MP : le cache ['dm_messages', id, …] ne doit JAMAIS
// contenir de messages chiffrés bruts (affichés vides, puis jamais rouverts).
import api from '../api/client'
import { t } from '../i18n'
import { openMessage, openText, type RawMsg } from './conversations'
import type { EncPayload } from './crypto'

/** Message de MP tel que renvoyé par le serveur. */
export type RawDm = RawMsg & { reply_to?: { id: string; content: string | null; enc?: EncPayload | null; client_msg_id?: string | null; sender_id: string; sender_username: string } | null }

/** Déchiffre un MP et l'aperçu du message auquel il répond. */
export async function openDm(dmId: string, m: RawDm) {
  const o = await openMessage('dm', dmId, m)
  const r = m.reply_to
  if (r?.enc) {
    const text = await openText('dm', dmId, r.enc, r.sender_id, r.client_msg_id)
    return { ...o, reply_to: { ...r, content: text ?? t('e2e.msg.locked') }, ...(text === null ? { e2e_reply: 'locked' as const } : {}) }
  }
  return o
}

/** Page de messages déchiffrés (`around` : autour d'un message cité ou recherché). */
export async function fetchDmMessages(dmId: string, around?: string | null) {
  const open = (list: RawDm[]) => Promise.all(list.map(m => openDm(dmId, m)))
  if (around) {
    try {
      const res = await api.get(`/dms/${dmId}/messages?around=${around}&limit=50`)
      if (res.data?.length > 0) return open(res.data)
    } catch { /* message introuvable : page la plus récente */ }
  }
  return api.get(`/dms/${dmId}/messages`).then(r => open(r.data))
}
