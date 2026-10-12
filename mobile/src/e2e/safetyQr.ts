// Code de sécurité en QR code (audit 2026-10-12, amélioration n° 11). Le QR porte le même code de
// 60 chiffres que l'écran (identique des deux côtés si personne ne s'interpose), préfixé et
// versionné. En personne, l'un scanne l'écran de l'autre : égalité stricte = clés vérifiées ;
// différence = quelqu'un s'interpose (ou une clé a changé) : on ne marque rien.
// Même fichier côté web (client/src/e2e/safetyQr.ts).

import QRCode from 'qrcode'

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

/** Matrice du QR : lignes de segments sombres fusionnés (peu de vues). */
export function qrRows(text: string): { size: number; rows: [number, number][][] } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = qr.modules
  const rows: [number, number][][] = []
  for (let y = 0; y < size; y++) {
    const runs: [number, number][] = []
    let start = -1
    for (let x = 0; x <= size; x++) {
      const dark = x < size && !!data[y * size + x]
      if (dark && start < 0) start = x
      if (!dark && start >= 0) { runs.push([start, x - start]); start = -1 }
    }
    rows.push(runs)
  }
  return { size, rows }
}
