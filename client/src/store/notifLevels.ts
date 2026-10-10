// Règles pures du centre de notifications (sans dépendance : testées par
// scripts/notifLevels.test.mjs). Même hiérarchie que server/src/notify.rs.
export type NotifLevel = 'inherit' | 'all' | 'mentions' | 'nothing'
export type Effective = Exclude<NotifLevel, 'inherit'>

/**
 * Niveau effectif : salon > catégorie > serveur > défaut du serveur
 * (« mentions seulement » si inconnu). Même règle que notify.rs::effective_level.
 */
export function resolveLevel(channel?: NotifLevel, category?: NotifLevel, server?: NotifLevel, serverDefault?: string): Effective {
  for (const l of [channel, category, server]) if (l && l !== 'inherit') return l
  return serverDefault === 'all' || serverDefault === 'nothing' ? serverDefault : 'mentions'
}

/** Nouveau post de forum : alerte si le forum est en « tous les messages », ou si le serveur demande les posts de forum (sauf « rien »). */
export const forumPostAlerts = (level: Effective, serverWantsPosts: boolean) =>
  level === 'all' || (serverWantsPosts && level !== 'nothing')
