import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmOptions {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: boolean) => void
}

let _pending: ConfirmRequest | null = null
let _listener: (() => void) | null = null

export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  return new Promise((resolve) => {
    _pending = {
      ...(typeof opts === 'string' ? { message: opts } : opts),
      resolve,
    }
    _listener?.()
  })
}

export function ConfirmModal() {
  const [req, setReq] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    _listener = () => setReq(_pending)
    return () => { _listener = null }
  }, [])

  if (!req) return null

  const resolve = (result: boolean) => {
    req.resolve(result)
    setReq(null)
    _pending = null
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => resolve(false)} />
      <div className="relative bg-fc-channel border border-white/10 rounded-xl shadow-2xl p-6 max-w-sm w-full">
        {req.danger && (
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
              <AlertTriangle size={24} className="text-red-400" />
            </div>
          </div>
        )}
        {req.title && (
          <h3 className="text-white font-semibold text-center mb-2">{req.title}</h3>
        )}
        <p className="text-fc-muted text-sm text-center leading-relaxed mb-6">{req.message}</p>
        <div className="flex gap-3">
          <button
            onClick={() => resolve(false)}
            className="flex-1 px-4 py-2 rounded-lg bg-fc-hover hover:bg-fc-hover/70 text-fc-text text-sm font-medium transition"
          >
            {req.cancelLabel ?? 'Annuler'}
          </button>
          <button
            onClick={() => resolve(true)}
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
