// Routes du lot « Messages et discussion » (server/src/handlers/disappearing.rs, drafts.rs,
// scheduled.rs, polls.rs). Tout contenu passe chiffré : texte des messages programmés et
// brouillons scellés sur l'appareil.
import { http, path } from '@/lib/http'
import { openRawList } from '@/e2e/conversations'
import { sendChannelText } from '@/e2e/channels'
import type { DraftBlob } from '@/e2e/crypto'
import { normalizeScheduledAll, normalizeVoters, parseDisappear, type ScheduledEntry } from '@/features/chat/messaging'

export const messagingApi = {
  /** Messages éphémères d'un MP ou d'un groupe. */
  async disappearing(kind: 'dm' | 'group', id: string): Promise<number | null> {
    return parseDisappear((await http.get<{ seconds?: unknown }>(path`/disappearing/${kind}/${id}`)).seconds)
  },
  setDisappearing: (kind: 'dm' | 'group', id: string, seconds: number | null) =>
    http.put(path`/disappearing/${kind}/${id}`, { seconds }),
  /** Salon : messages éphémères (`null` = désactivés) et fils automatiques, avec le droit de modifier les salons. */
  setChannelMessaging: (serverId: string, channelId: string, body: { disappear_seconds?: number | null; auto_threads?: boolean }) =>
    http.put(path`/servers/${serverId}/channels/${channelId}/messaging`, body),

  /** Brouillons chiffrés de mon compte. */
  drafts: () => http.get<{ conv_id: string; blob: DraftBlob }[]>('/drafts'),
  putDraft: (convId: string, blob: DraftBlob) => http.put(path`/drafts/${convId}`, blob),
  deleteDraft: (convId: string) => http.delete(path`/drafts/${convId}`),

  /** Tous mes messages programmés, déchiffrés ici (auteur = moi, `user_id`). */
  async scheduledAll(): Promise<ScheduledEntry[]> {
    const raw = await http.get<unknown[]>('/scheduled')
    const list = Array.isArray(raw) ? raw : []
    const out: unknown[] = []
    for (const r of list) {
      const channelId = (r as { channel_id?: unknown })?.channel_id
      out.push(...(typeof channelId === 'string' ? await openRawList('channel', channelId, [r]) : []))
    }
    return normalizeScheduledAll(out)
  },
  /** Nouvelle date et/ou nouveau texte (rechiffré avec l'id client du message programmé). */
  async updateScheduled(e: ScheduledEntry, text: string | null, sendAt: Date) {
    const send_at = sendAt.toISOString()
    if (text === null) return http.patch(path`/scheduled/${e.id}`, { send_at })
    return (await sendChannelText(e.serverId, e.channelId, text, (body) =>
      http.patch(path`/scheduled/${e.id}`, { send_at, enc: body.enc, client_msg_id: body.client_msg_id }),
    { clientMsgId: e.clientMsgId, preview: true, edit: true })).result
  },
  sendScheduledNow: (id: string) => http.post(path`/scheduled/${id}/send`),

  /** Votants d'un sondage non anonyme, par option. */
  async pollVoters(serverId: string, channelId: string, pollId: string): Promise<Record<string, string[]>> {
    return normalizeVoters(await http.get<unknown>(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}/voters`))
  },
}
