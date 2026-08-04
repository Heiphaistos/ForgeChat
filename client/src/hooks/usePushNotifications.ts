import { useState, useCallback } from 'react'
import { stripMarkdown } from '../utils/mdShortcuts'
import { queryClient } from '../main'

// `quiet_hours_*` (PrivacySection.tsx) était sauvegardé et réaffiché mais jamais
// consulté nulle part -- un pur placebo côté UI, comme les autres réglages du même
// type trouvés cette session. Il n'existe aucun push serveur (pas de crate web-push/
// VAPID côté back) : les notifications sont déclenchées localement à la réception
// d'un event WS, donc l'application de ce réglage doit se faire ici, au point d'appel
// central déjà utilisé par tous les événements notifiables.
function isWithinQuietHours(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return false
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return false
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  // Plage traversant minuit (ex. 22:00 -> 08:00) vs plage normale (ex. 09:00 -> 17:00)
  return startMin <= endMin
    ? nowMin >= startMin && nowMin < endMin
    : nowMin >= startMin || nowMin < endMin
}

function isQuietHoursActive(): boolean {
  const settings = queryClient.getQueryData<{
    quiet_hours_enabled?: boolean
    quiet_hours_start?: string | null
    quiet_hours_end?: string | null
  }>(['user-settings'])
  if (!settings?.quiet_hours_enabled) return false
  return isWithinQuietHours(settings.quiet_hours_start, settings.quiet_hours_end)
}

export function usePushNotifications() {
  const supported = typeof window !== 'undefined' && 'Notification' in window

  const [enabled, setEnabled] = useState<boolean>(() => {
    if (!supported) return false
    return Notification.permission === 'granted'
  })

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!supported) return false
    if (Notification.permission === 'granted') {
      setEnabled(true)
      return true
    }
    const result = await Notification.requestPermission()
    const granted = result === 'granted'
    setEnabled(granted)
    return granted
  }, [supported])

  return { supported, enabled, requestPermission }
}

// ── Utilitaire pour envoyer une notification si la fenêtre n'est pas focus ──
export function sendNativeNotification(
  title: string,
  options?: NotificationOptions & { onClick?: () => void }
): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return
  if (isQuietHoursActive()) return

  try {
    const { onClick, ...notifOptions } = options ?? {}
    // Le corps est toujours du contenu de message : aplatir le markdown
    // (**gras** littéral illisible dans une notification système)
    if (typeof notifOptions.body === 'string') {
      notifOptions.body = stripMarkdown(notifOptions.body)
    }
    const notif = new Notification(title, {
      icon: '/icon.svg',
      badge: '/icon.svg',
      ...notifOptions,
    })
    if (onClick) {
      notif.onclick = () => {
        window.focus()
        onClick()
        notif.close()
      }
    }
  } catch {}
}
