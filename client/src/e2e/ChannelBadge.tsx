// Salons de serveur : cadenas d'en-tête (« chiffré » ou « crée ta clé ») et
// mention discrète « non chiffré » sur un message envoyé en clair.
import { Lock, LockOpen } from 'lucide-react'
import { useT } from '../i18n'
import { useChannelEncrypted } from './channels'

export function ChannelLock({ channelId }: { channelId: string }) {
  const t = useT()
  const encrypted = useChannelEncrypted(channelId)
  if (encrypted === undefined) return null
  const label = encrypted ? t('e2e.channel.encrypted') : t('e2e.channel.noKey')
  return (
    <span
      role="img"
      aria-label={label}
      title={encrypted ? `${label}\n${t('e2e.channel.desc')}` : label}
      className={`flex-shrink-0 ${encrypted ? 'text-green-400' : 'text-fc-muted'}`}
    >
      {encrypted ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
    </span>
  )
}

/**
 * Mention « non chiffré ». `warn` (MP, groupe) : aucun envoi légitime n'y est en clair, donc ce
 * message vient peut-être du serveur et non de la personne affichée : avertissement appuyé.
 */
export function UnencryptedBadge({ warn = false }: { warn?: boolean }) {
  const t = useT()
  const title = warn ? t('e2e.unencrypted.warnTitle') : t('e2e.unencrypted.title')
  return (
    <span
      title={title}
      className={warn
        ? 'ml-1.5 align-middle text-[10px] font-semibold text-red-300 bg-red-500/15 border border-red-500/60 rounded px-1 select-none'
        : 'ml-1.5 align-middle text-[10px] text-fc-muted border border-fc-hover rounded px-1 select-none'}
    >
      <span className="sr-only">{title}</span>
      <span aria-hidden>{warn ? t('e2e.unencrypted.warn') : t('e2e.unencrypted')}</span>
    </span>
  )
}
