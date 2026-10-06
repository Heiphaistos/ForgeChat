import { http, path } from '@/lib/http'
import { normalizePoll, type Poll } from '@/features/chat/polls'

/** Sondages d'un salon (handlers/polls.rs). Le vote remplace tous mes choix ; [] = retirer mon vote. */
export const pollsApi = {
  async get(serverId: string, channelId: string, pollId: string): Promise<Poll> {
    const poll = normalizePoll(await http.get<unknown>(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}`))
    if (!poll) throw new Error('Sondage illisible')
    return poll
  },
  vote: (serverId: string, channelId: string, pollId: string, optionIds: string[]) =>
    http.post(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}/vote`, { option_ids: optionIds }),
  /** Créateur ou modérateur. */
  close: (serverId: string, channelId: string, pollId: string) => http.post(path`/servers/${serverId}/channels/${channelId}/polls/${pollId}/close`),
}
