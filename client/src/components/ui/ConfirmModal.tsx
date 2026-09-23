import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Troisième bouton (au-dessus des deux autres) ; voir `confirmChoice`. */
  altLabel?: string
}

export type ConfirmChoice = 'confirm' | 'alt' | 'cancel'

interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: ConfirmChoice) => void
}

let _pending: ConfirmRequest | null = null
let _listener: (() => void) | null = null

/** Confirmation à trois choix : `altLabel`, `confirmLabel` ou annuler. */
export function confirmChoice(opts: ConfirmOptions): Promise<ConfirmChoice> {
  return new Promise((resolve) => {
    _pending = { ...opts, resolve }
    _listener?.()
  })
}

export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  return confirmChoice(typeof opts === 'string' ? { message: opts } : opts).then(c => c === 'confirm')
}

export function ConfirmModal() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    _listener = () => setReq(_pending)
    return () => { _listener = null }
  }, [])

  // Escape = annuler (capture : prend le pas sur les autres handlers Escape)
  useEffect(() => {
    if (!req) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        req.resolve('cancel')
        setReq(null)
        _pending = null
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [req])

  if (!req) return null

  const resolve = (result: ConfirmChoice) => {
    req.resolve(result)
    setReq(null)
    _pending = null
  }

  const labelId = req.title ? 'confirm-title' : 'confirm-msg'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => resolve('cancel')} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelId}
        aria-describedby="confirm-msg"
        className="relative bg-fc-channel border border-white/10 rounded-xl shadow-2xl p-6 max-w-sm w-full"
      >
        {req.danger && (
          <div className="flex justify-center mb-3" aria-hidden>
            <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
              <AlertTriangle size={24} className="text-red-400" />
            </div>
          </div>
        )}
        {req.title && (
          <h3 id="confirm-title" className="text-white font-semibold text-center mb-2">{req.title}</h3>
        )}
        <p id="confirm-msg" className="text-fc-muted text-sm text-center leading-relaxed mb-6">{req.message}</p>
        {req.altLabel && (
          <button
            onClick={() => resolve('alt')}
            className="w-full mb-3 px-4 py-2 rounded-lg bg-fc-accent hover:bg-indigo-500 text-white text-sm font-medium transition"
          >
            {req.altLabel}
          </button>
        )}
        <div className="flex gap-3">
          <button
            autoFocus
            onClick={() => resolve('cancel')}
            className="flex-1 px-4 py-2 rounded-lg bg-fc-hover hover:bg-fc-hover/70 text-fc-text text-sm font-medium transition"
          >
            {req.cancelLabel ?? 'Annuler'}
          </button>
          <button
            onClick={() => resolve('confirm')}
            className={`flex-1 px-4 py-2 rounded-lg text-white text-sm font-medium transition ${
              req.danger
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-fc-accent hover:bg-indigo-500'
            }`}
          >
            {req.confirmLabel ?? 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  )
}
