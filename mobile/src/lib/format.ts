/** Formatage dates / tailles (français, ou anglais selon la langue de l'interface). */
import { t, useLang } from '@/i18n'
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
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** « 12 mars » / « Mar 12 ». */
const dayMonth = (d: Date) => t('date.dayMonth', { d: d.getDate(), m: (useLang.getState().lang === 'en' ? MONTHS_EN : MONTHS)[d.getMonth()]! })

export function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (isSameDay(iso, today.toISOString())) return t('date.today')
  if (isSameDay(iso, yesterday.toISOString())) return t('date.yesterday')
  const sameYear = d.getFullYear() === today.getFullYear()
  return `${dayMonth(d)}${sameYear ? '' : ` ${d.getFullYear()}`}`
}

/** « 14:05 », « Hier », « 12 mars » selon l'ancienneté (listes de conversations). */
export function formatShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isSameDay(iso, new Date().toISOString())) return formatTime(iso)
  if (isSameDay(iso, new Date(Date.now() - 86_400_000).toISOString())) return t('date.yesterday')
  return dayMonth(d)
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return t('date.justNow')
  if (diff < 3600) return t('date.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86_400) return t('date.hoursAgo', { n: Math.floor(diff / 3600) })
  return t('date.dayAt', { day: formatDay(iso), time: formatTime(iso) })
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
  return t(count > 1 ? 'common.unreadMany' : 'common.unread', { n: count })
}
