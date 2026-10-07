/** Formatage dates / tailles (fr-FR). */
import { appearance, type AppearancePrefs } from '@/theme/prefs'

const pad = (n: number) => (n < 10 ? `0${n}` : String(n))

/** « 14:05 », ou « 02:05 PM » en 12 h (format du web, réglage time_format). */
export function formatTime(iso: string, fmt: AppearancePrefs['timeFormat'] = appearance.timeFormat): string {
  const d = new Date(iso)
  const h = d.getHours()
  return fmt === '12h' ? `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}` : `${pad(h)}:${pad(d.getMinutes())}`
}

export function isSameDay(a: string, b: string): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

export function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (isSameDay(iso, today.toISOString())) return "Aujourd'hui"
  if (isSameDay(iso, yesterday.toISOString())) return 'Hier'
  const sameYear = d.getFullYear() === today.getFullYear()
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`
}

/** « 14:05 », « Hier », « 12 mars » selon l'ancienneté (listes de conversations). */
export function formatShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isSameDay(iso, new Date().toISOString())) return formatTime(iso)
  const day = formatDay(iso)
  return day === "Aujourd'hui" ? formatTime(iso) : day === 'Hier' ? 'Hier' : `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return "à l'instant"
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`
  if (diff < 86_400) return `il y a ${Math.floor(diff / 3600)} h`
  return `${formatDay(iso)} à ${formatTime(iso)}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`
  return `${(n / 1024 / 1024).toFixed(1)} Mo`
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** Libellé d'accessibilité des non-lus, accordé : « 1 non lu », « 3 non lus ». */
export function unreadLabel(count: number): string {
  return count > 1 ? `${count} non lus` : `${count} non lu`
}
