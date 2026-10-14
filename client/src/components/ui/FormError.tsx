import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'

/**
 * Erreur de formulaire : bannière `role="alert"` (lue par les lecteurs d'écran, reste affichée) en plus
 * du toast. Le toast est rendu muet côté ARIA pour que l'erreur ne soit pas annoncée deux fois.
 */
export function useFormError() {
  const [error, setError] = useState('')
  const fail = useCallback((message: string) => {
    setError(message)
    toast.error(message, { ariaProps: { role: 'status', 'aria-live': 'off' } })
  }, [])
  const clear = useCallback(() => setError(''), [])
  const el = error
    ? <p role="alert" className="rounded bg-red-500/10 border border-red-500/40 text-red-300 text-sm px-3 py-2">{error}</p>
    : null
  return { fail, clear, el }
}
