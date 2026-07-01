import { useState, useCallback } from 'react'

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

  try {
    const { onClick, ...notifOptions } = options ?? {}
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
