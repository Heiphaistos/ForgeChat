import { t } from '@/i18n'
import { http, path } from '@/lib/http'
import { normalizePoll, type Poll, type PollBody } from '@/features/chat/polls'
import { openPoll, sealPoll } from '@/e2e/channels'

/** Sondages d'un salon (handlers/polls.rs). Le vote remplace tous mes choix ; [] = retirer mon vote. */
export const pollsApi = {
  /** Sondage chiffré : question et options déchiffrées sur l'appareil (votes en clair). */
  async get(serverId: string, channelId: string, pollId: string): Promise<Poll> {
    const raw = await http.get<unknown>(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}`)
    const poll = normalizePoll(raw && typeof raw === 'object' ? await openPoll(channelId, raw as Record<string, unknown>) : raw)
    if (!poll) throw new Error(t('store.api.pollUnreadable'))
    return poll
  },
  vote: (serverId: string, channelId: string, pollId: string, optionIds: string[]) =>
    http.post(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}/vote`, { option_ids: optionIds }),
  /** Le serveur publie aussi le message qui porte le sondage ; chiffré dès que j'ai une clé. */
  create: async (serverId: string, channelId: string, body: PollBody) =>
    http.post(path`/servers/${serverId}/channels/${channelId}/polls`, await sealPoll(channelId, body)),
  /** Créateur ou modérateur. */
  close: (serverId: string, channelId: string, pollId: string) => http.post(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}/close`),
}
