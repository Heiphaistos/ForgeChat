// Constantes et petits helpers partagés entre MessageList.tsx (conteneur) et
// MessageRow.tsx (ligne mémoïsée) — évite de dupliquer ces définitions dans les deux fichiers.
import { useCountdown } from '../../hooks/useCountdown'
import { useT } from '../../i18n'

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀']
export const REACTION_PICKER_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👏', '🤔', '✅', '❌', '🚀', '💯', '😎', '🙏', '💪', '🤡', '👀', '🫡', '💀']
export const DBLCLICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🔥']

export { previewUrl as extractFirstUrl } from '../../e2e/channelText'

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function EphemeralBadge({ expiresAt }: { expiresAt: string }) {
  const remaining = useCountdown(expiresAt)
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-fc-red/20 text-fc-red font-medium">
      ⏱ {remaining}
    </span>
  )
}

/** Message « après lecture » pas encore lu par tous : il disparaîtra 5 minutes après lecture. */
export function AfterReadBadge() {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-fc-red/20 text-fc-red font-medium" title={t('disappear.badgeRead')}>
      ⏱ {t('disappear.short.afterRead')}
    </span>
  )
}
