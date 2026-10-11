// « Ajouter une note » / « Ajouter un pseudo d'ami » : la note privée chiffrée et le surnom
// existants (UserPrivateNotes), dans une petite fenêtre ; « Voir le code de vérification » :
// le code de sécurité E2E partagé avec la personne (SafetyCode), à comparer hors bande.
import type { ReactNode } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useT } from '../../i18n'
import { SafetyCode } from '../../e2e/E2ESettings'
import UserPrivateNotes from '../UserPrivateNotes'

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeKey(onClose)
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label={title}
        className="relative bg-fc-sidebar border border-white/10 rounded-xl shadow-2xl p-5 w-full max-w-sm">
        <h3 className="text-white font-semibold mb-3">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function SafetyCodeDialog({ userId, username, onClose }: { userId: string; username: string; onClose: () => void }) {
  const t = useT()
  return (
    <Shell title={t('um.verifyTitle', { name: username })} onClose={onClose}>
      <SafetyCode userId={userId} />
      <button onClick={onClose} className="w-full btn-primary text-sm py-2 mt-3">{t('common.close')}</button>
    </Shell>
  )
}

export default function UserNoteDialog({ userId, username, isFriend, onClose }: {
  userId: string; username: string; isFriend: boolean; onClose: () => void
}) {
  const t = useT()
  // Les champs s'enregistrent à la perte du focus : on la provoque avant de fermer.
  const close = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    onClose()
  }
  return (
    <Shell title={t('um.noteTitle', { name: username })} onClose={close}>
      <UserPrivateNotes userId={userId} isFriend={isFriend} />
      <p className="text-[11px] text-fc-muted mb-3">{t('um.noteSaved')} {t('um.onlyYou')}.</p>
      <button onClick={close} className="w-full btn-primary text-sm py-2">{t('common.close')}</button>
    </Shell>
  )
}
