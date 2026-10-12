// Code de sécurité en QR code (audit 2026-10-12, amélioration n° 11). Le QR porte le même code de
// 60 chiffres que l'écran (identique des deux côtés si personne ne s'interpose), préfixé et
// versionné. En personne, l'un scanne l'écran de l'autre : égalité stricte = clés vérifiées ;
// différence = quelqu'un s'interpose (ou une clé a changé) : on ne marque rien.
// Même fichier côté mobile (mobile/src/e2e/safetyQr.ts). Testé par scripts/safetyQr.test.mjs.

const PREFIX = 'FCSAFE1:'

export function safetyPayload(code: string): string {
  return PREFIX + code
}

export type SafetyScan = 'match' | 'mismatch' | 'invalid'

/** Compare le QR scanné au code calculé ici (temps constant sur la longueur fixe). */
export function compareSafetyScan(scanned: string, mine: string): SafetyScan {
  const m = /^FCSAFE1:(\d{60})$/.exec(scanned.trim())
  if (!m || !/^\d{60}$/.test(mine)) return 'invalid'
  let diff = 0
  for (let i = 0; i < 60; i++) diff |= m[1]!.charCodeAt(i) ^ mine.charCodeAt(i)
  return diff === 0 ? 'match' : 'mismatch'
}
