/* eslint-disable no-console */
/**
 * Logger centralisé.
 * - En production : seuls warn/error sont émis.
 * - Toujours : masquage des secrets (JWT, refresh tokens, tickets WS, Bearer).
 */

const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /(Bearer\s+)[A-Za-z0-9._-]+/gi,
  /("?(?:access_token|refresh_token|ticket|password|totp_code|token)"?\s*[:=]\s*"?)[^",\s}&]+/gi,
  /([?&](?:ticket|token)=)[^&\s]+/gi,
]

export function redact(input: unknown): string {
  let text: string
  if (typeof input === 'string') text = input
  else if (input instanceof Error) text = `${input.name}: ${input.message}`
  else {
    try {
      text = JSON.stringify(input)
    } catch {
      text = String(input)
    }
  }
  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, (_m, prefix?: string) =>
      typeof prefix === 'string' ? `${prefix}[redacted]` : '[redacted]',
    )
  }
  return text
}

const verbose = __DEV__

// Journal en mémoire des dernières lignes (déjà masquées), exporté depuis le panneau « Infos dev ».
// Hors production uniquement : EXPO_PUBLIC_APP_ENV est inliné à la compilation, la condition est
// donc constante et ce code disparaît du bundle du client-apk.
const MAX_LINES = 400
const buffer: string[] = []
function record(level: string, scope: string, args: unknown[]) {
  if (process.env.EXPO_PUBLIC_APP_ENV === 'production') return
  buffer.push(`${new Date().toISOString()} ${level} [${scope}] ${args.map(redact).join(' ')}`)
  if (buffer.length > MAX_LINES) buffer.splice(0, buffer.length - MAX_LINES)
}

/** Dernières lignes de journal, secrets masqués (vide en production). */
export const recentLogs = (): readonly string[] => buffer
export const clearLogs = () => {
  buffer.length = 0
}

export const logger = {
  debug: (scope: string, ...args: unknown[]) => {
    record('DEBUG', scope, args)
    if (verbose) console.log(`[${scope}]`, ...args.map(redact))
  },
  info: (scope: string, ...args: unknown[]) => {
    record('INFO', scope, args)
    if (verbose) console.info(`[${scope}]`, ...args.map(redact))
  },
  warn: (scope: string, ...args: unknown[]) => {
    record('WARN', scope, args)
    console.warn(`[${scope}]`, ...args.map(redact))
  },
  error: (scope: string, ...args: unknown[]) => {
    record('ERROR', scope, args)
    console.error(`[${scope}]`, ...args.map(redact))
  },
}
