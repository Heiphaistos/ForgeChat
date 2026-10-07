// Anniversaires (lot « Profil et social ») : règles partagées par l'écran de réglage
// et la liste d'amis. Testé par scripts/social.test.mjs.

export interface DayMonth { month: number; day: number }

/** Même règle que le serveur (birthdays.rs) : sans année, le 29 février est permis. */
export function validBirthday(month: number, day: number, year: number | null, today = new Date()): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false
  const y = year ?? 2000
  if (year !== null && (!Number.isInteger(year) || year < 1900)) return false
  const d = new Date(Date.UTC(y, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return false
  if (year !== null) {
    const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
    if (d.getTime() > t) return false
  }
  return true
}

/** Jours jusqu'au prochain anniversaire (0 = aujourd'hui ; 29/02 fêté le 28/02 hors années bissextiles). */
export function daysUntil(b: DayMonth, today = new Date()): number {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  for (const y of [today.getFullYear(), today.getFullYear() + 1]) {
    let day = b.day
    if (b.month === 2 && b.day === 29 && new Date(Date.UTC(y, 1, 29)).getUTCMonth() !== 1) day = 28
    const t = Date.UTC(y, b.month - 1, day)
    if (t >= start) return Math.round((t - start) / 86_400_000)
  }
  return 366
}

/** Amis dont l'anniversaire tombe dans les `within` prochains jours, du plus proche au plus lointain. */
export function upcomingBirthdays<T extends { birthday?: DayMonth | null }>(friends: T[], within = 7, today = new Date()) {
  return friends
    .flatMap(f => (f.birthday ? [{ friend: f, days: daysUntil(f.birthday, today) }] : []))
    .filter(x => x.days <= within)
    .sort((a, b) => a.days - b.days)
}
