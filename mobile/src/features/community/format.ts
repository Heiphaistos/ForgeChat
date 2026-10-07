// Fonctions pures du lot « Serveurs et communauté », identiques au web
// (client/src/components/community/format.ts) ; testées par __tests__/community.test.ts.

/** CSV (RFC 4180) ; une cellule qui commence par = + - @ est neutralisée (injection de formule). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n'
}

const gcalDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Lien « Ajouter à Google Agenda » (simple lien, aucune API ni service payant). */
export function googleCalendarUrl(e: { name: string; description?: string | null; start_time: string; end_time?: string | null; recurrence?: string }): string {
  const end = e.end_time ?? new Date(new Date(e.start_time).getTime() + 3600_000).toISOString()
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.name, dates: `${gcalDate(e.start_time)}/${gcalDate(end)}` })
  if (e.description) p.set('details', e.description)
  const freq = ({ daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' } as Record<string, string>)[e.recurrence ?? '']
  if (freq) p.set('recur', `RRULE:FREQ=${freq}`)
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

/** Avancement dans le niveau courant, entre 0 et 1. */
export function levelProgress(xp: number, levelXp: number, nextXp: number): number {
  if (!(nextXp > levelXp)) return 1
  return Math.min(1, Math.max(0, (xp - levelXp) / (nextXp - levelXp)))
}

/** Même rendu que le serveur (`community::render_welcome`) : {user}, {server}, {count}. */
export const renderWelcome = (text: string, user: string, server: string, count: number) =>
  text.split('{user}').join(user).split('{server}').join(server).split('{count}').join(String(count))

/** Étiquettes d'annuaire saisies « a, b, c » → liste propre (même règle que le serveur). */
export function parseTags(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(',')) {
    const tag = raw.trim().toLowerCase()
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out.slice(0, 5)
}
