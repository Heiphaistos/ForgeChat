/** Types d'événement acceptés par handlers/events.rs. */
export const EVENT_TYPES = [
  { value: 'event', label: 'Événement' },
  { value: 'meeting', label: 'Réunion' },
  { value: 'stream', label: 'Live' },
  { value: 'other', label: 'Autre' },
]

/**
 * Date locale saisie « JJ/MM/AAAA » + « HH:MM » → Date, ou null si invalide
 * (31/02, 25:00…). Pas de sélecteur natif installé : saisie au clavier.
 */
export function parseLocalDateTime(day: string, time: string): Date | null {
  const d = day.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/)
  const t = time.match(/^\s*(\d{1,2})[:h](\d{2})\s*$/)
  if (!d || !t) return null
  const [dd, mm, yyyy, hh, min] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [number, number, number, number, number]
  if (hh > 23 || min > 59) return null
  const out = new Date(yyyy, mm - 1, dd, hh, min)
  // Le constructeur reporte les débordements (31/02 → 03/03) : on les refuse.
  return out.getFullYear() === yyyy && out.getMonth() === mm - 1 && out.getDate() === dd ? out : null
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Valeurs par défaut des champs : demain à 20 h. */
export function defaultEventFields(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { day: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`, time: '20:00' }
}

/** « samedi 12 oct. à 20:30 » */
export const formatEventDate = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
