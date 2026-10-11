// Règles pures du centre de notifications, mêmes que le web (client/src/store/notifLevels.ts)
// et que le serveur (server/src/notify.rs::effective_level). Testées dans __tests__/notif-center.test.ts.
export type NotifLevel = 'inherit' | 'all' | 'mentions' | 'nothing'
export type Effective = Exclude<NotifLevel, 'inherit'>

/** Niveau effectif : salon > catégorie > serveur > défaut du serveur (« mentions » si inconnu). */
export function resolveLevel(channel?: NotifLevel, category?: NotifLevel, server?: NotifLevel, serverDefault?: string | null): Effective {
  for (const l of [channel, category, server]) if (l && l !== 'inherit') return l
  return serverDefault === 'all' || serverDefault === 'nothing' ? serverDefault : 'mentions'
}

/** Nouveau post de forum : alerte si le forum est en « tous les messages », ou si le serveur demande les posts (sauf « rien »). */
export const forumPostAlerts = (level: Effective, serverWantsPosts: boolean) => level === 'all' || (serverWantsPosts && level !== 'nothing')

/** Sourdine encore active (échéance ISO absente = jusqu'à réactivation). */
export const stillMuted = (muted: boolean | undefined, until: string | null | undefined, now = Date.now()) =>
  !!muted && (!until || Date.parse(until) > now)
