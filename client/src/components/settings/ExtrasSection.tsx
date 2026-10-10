import { useT } from '../../i18n'
import { PrefToggle } from './UxPrefControls'

/** Petits plus (à la Vencord), tous sur l'appareil et désactivables. */
export default function ExtrasSection() {
  const t = useT()
  return (
    <div className="space-y-3">
      <p className="text-sm text-fc-muted">{t('ux.extras.intro')}</p>
      <PrefToggle k="silentTyping" label="ux.extras.silentTyping" desc="ux.extras.silentTypingDesc" />
      <PrefToggle k="cleanUrls" label="ux.extras.cleanUrls" desc="ux.extras.cleanUrlsDesc" />
      <PrefToggle k="showUsername" label="ux.extras.showUsername" desc="ux.extras.showUsernameDesc" />
      <PrefToggle k="replyPing" label="ux.extras.replyPing" desc="ux.extras.replyPingDesc" />
      <PrefToggle k="messageLogger" label="ux.extras.logger" desc="ux.extras.loggerDesc" />
      <p className="text-xs text-fc-muted">{t('ux.extras.already')}</p>
    </div>
  )
}
