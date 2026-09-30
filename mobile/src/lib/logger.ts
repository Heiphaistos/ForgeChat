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

export const logger = {
  debug: (scope: string, ...args: unknown[]) => {
    if (verbose) console.log(`[${scope}]`, ...args.map(redact))
  },
  info: (scope: string, ...args: unknown[]) => {
    if (verbose) console.info(`[${scope}]`, ...args.map(redact))
  },
  warn: (scope: string, ...args: unknown[]) => {
    console.warn(`[${scope}]`, ...args.map(redact))
  },
  error: (scope: string, ...args: unknown[]) => {
    console.error(`[${scope}]`, ...args.map(redact))
  },
}
