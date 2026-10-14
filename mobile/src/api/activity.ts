import { normalizeActivity, type ActivityItem } from '@/features/social/activityFeed'
import { http } from '@/lib/http'

/** Flux d'activité des serveurs communs (GET /activity-feed, 48 h, tri décroissant). */
export const activityApi = {
  async feed(limit = 50): Promise<ActivityItem[]> {
    return normalizeActivity(await http.get<unknown>('/activity-feed', { query: { limit } }))
  },
}
