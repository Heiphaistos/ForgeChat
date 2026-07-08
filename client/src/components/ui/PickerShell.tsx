import { createPortal } from 'react-dom'

interface Props {
  onClose: () => void
  /** Classes du mode desktop (popup absolute ancrée au bouton) */
  desktopClassName: string
  desktopStyle?: React.CSSProperties
  children: React.ReactNode
}

// Fallback Suspense des pickers lazy : même position que le picker final
// (sheet en bas sur mobile, popup ancrée sur desktop) pour éviter le flash
export function PickerFallback({ desktopClassName }: { desktopClassName: string }) {
  const isSheet = window.innerWidth < 768
  return (
    <div
      style={isSheet ? { position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, height: '12rem' } : undefined}
      className={isSheet
        ? 'bg-fc-channel border-t border-fc-hover rounded-t-2xl flex items-center justify-center'
        : desktopClassName}
    >
      <div className="w-5 h-5 border-2 border-fc-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Coquille commune des pickers (emoji, GIF, stickers) : bottom-sheet en
// portal sur mobile (échappe aux parents transformés/animés), popup
// absolute ancrée au bouton sur desktop
export default function PickerShell({ onClose, desktopClassName, desktopStyle, children }: Props) {
  const isSheet = window.innerWidth < 768

  if (!isSheet) {
    return (
      <div className={desktopClassName} style={desktopStyle} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    )
  }

  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        className="bg-black/50"
        aria-hidden
        onClick={onClose}
      />
      <div
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999, maxHeight: '70dvh' }}
        className="bg-fc-channel border-t border-fc-hover rounded-t-2xl shadow-2xl overflow-hidden flex flex-col pb-[max(env(safe-area-inset-bottom),0.25rem)] sheet-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mt-1.5 mb-0.5 w-10 h-1 rounded-full bg-fc-hover flex-shrink-0" aria-hidden />
        {children}
      </div>
    </>,
    document.body
  )
}
