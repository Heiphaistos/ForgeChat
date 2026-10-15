// Lot « Messages et discussion » : brouillons chiffrés synchronisés, réglage des messages
// éphémères tenu à jour, index local de recherche purgé des messages supprimés ou échus.
import { bindDraftSync } from '@/e2e/drafts'
import { clearSearchIndex, unindexMessage } from '@/e2e/searchIndex'
import { parseDisappear } from '@/features/chat/messaging'
import { queryClient } from '@/lib/queryClient'
import { realtime } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import { useLocalNotices } from '@/stores/localNotices'

export const disappearingKey = (kind: 'dm' | 'group', id: string) => ['disappearing', kind, id] as const

export function bindMessaging(): () => void {
  const offs = [
    bindDraftSync(),
    realtime.on('DISAPPEARING_UPDATE', (e) => {
      const kind = e.conv_kind === 'dm' || e.conv_kind === 'group' ? e.conv_kind : null
      if (kind && typeof e.conv_id === 'string') queryClient.setQueryData(disappearingKey(kind, e.conv_id), parseDisappear(e.seconds))
    }),
    // Réponse éphémère d'une commande (/help, refus…) : message local, visible de moi seul.
    realtime.on('COMMAND_RESPONSE', (e) => {
      if (typeof e.channel_id !== 'string' || typeof e.content !== 'string') return
      useLocalNotices.getState().add(e.channel_id, { command: String(e.command ?? ''), content: e.content })
    }),
    ...['MESSAGE_DELETE', 'DM_MESSAGE_DELETE', 'GROUP_DM_MESSAGE_DELETE'].map((type) =>
      realtime.on(type, (e) => {
        if (typeof e.message_id === 'string') unindexMessage(e.message_id)
      }),
    ),
    // Déconnexion : plus aucun texte déchiffré sur l'appareil.
    useAuth.subscribe((s, prev) => {
      if (prev.user && !s.user) clearSearchIndex()
    }),
  ]
  return () => offs.forEach((off) => off())
}
