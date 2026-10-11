// « Ajouter une note » / « Ajouter un pseudo d'ami » : la note privée chiffrée et le surnom
// existants (UserPrivateNotes), dans une petite fenêtre.
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT } from '../../i18n'
import UserPrivateNotes from '../UserPrivateNotes'

export default function UserNoteDialog({ userId, username, isFriend, onClose }: {
  userId: string; username: string; isFriend: boolean; onClose: () => void
}) {
  const t = useT()
  // Les champs s'enregistrent à la perte du focus : on la provoque avant de fermer.
  const close = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    onClose()
  }
  useEscapeKey(close)
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={close} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={t('um.noteTitle', { name: username })}
        className="relative bg-fc-sidebar border border-white/10 rounded-xl shadow-2xl p-5 w-full max-w-sm">
        <h3 className="text-white font-semibold mb-3">{t('um.noteTitle', { name: username })}</h3>
        <UserPrivateNotes userId={userId} isFriend={isFriend} />
        <p className="text-[11px] text-fc-muted mb-3">{t('um.noteSaved')} {t('um.onlyYou')}.</p>
        <button onClick={close} className="w-full btn-primary text-sm py-2">{t('common.close')}</button>
      </div>
    </div>
  )
}
