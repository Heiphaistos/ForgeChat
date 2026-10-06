/** Commandes « / » de la barre de saisie (mêmes commandes intégrées que MessageInput.tsx). */

export interface SlashCommand {
  name: string
  description: string
  /** Nom du bot pour une commande déclarée par un bot du serveur (GET /servers/:id/commands). */
  bot?: string
}

export const BUILTIN_COMMANDS: readonly SlashCommand[] = [
  { name: 'me', description: 'Envoie une action en italique' },
  { name: 'shrug', description: 'Envoie ¯\\_(ツ)_/¯' },
  { name: 'tableflip', description: 'Table flip !' },
  { name: 'unflip', description: 'Remet la table' },
  { name: 'lenny', description: 'Visage Lenny' },
  { name: 'clap', description: 'Applaudissements 👏 entre les mots' },
  { name: 'spoiler', description: 'Cache le texte en spoiler' },
  { name: 'giphy', description: 'Cherche un GIF' },
]

/** Commandes qui attendent un texte après leur nom. */
export const COMMANDS_WITH_ARGS = new Set(['me', 'clap', 'spoiler', 'giphy'])

const NAME = /^[a-z0-9_-]{1,32}$/

/** Commandes de bots lues défensivement : nom valide et non déjà pris par une commande intégrée. */
export function normalizeBotCommands(raw: unknown): SlashCommand[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set(BUILTIN_COMMANDS.map((c) => c.name))
  const out: SlashCommand[] = []
  for (const r of raw as Record<string, unknown>[]) {
    const name = typeof r?.name === 'string' ? r.name.toLowerCase() : ''
    if (!NAME.test(name) || taken.has(name)) continue
    taken.add(name)
    out.push({ name, description: typeof r.description === 'string' ? r.description : '', bot: typeof r.bot_name === 'string' ? r.bot_name : 'Bot' })
  }
  return out
}

/** Nom de commande en cours de saisie : le message commence par « / » sans espace encore tapé. */
export function activeSlashQuery(text: string): string | null {
  const m = /^\/([a-z0-9_-]{0,32})$/i.exec(text)
  return m ? m[1]!.toLowerCase() : null
}

export type BuiltinResult = { send: string } | { gif: string } | null

/**
 * Exécute une commande intégrée tapée en entier (« /shrug », « /me danse »). null : pas une
 * commande intégrée ou argument manquant — le texte part alors tel quel (commande de bot).
 */
export function runBuiltin(text: string): BuiltinResult {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const args = (m[2] ?? '').trim()
  switch (m[1]!.toLowerCase()) {
    case 'me':
      return args ? { send: `*${args}*` } : null
    case 'shrug':
      return { send: '¯\\_(ツ)_/¯' }
    case 'tableflip':
      return { send: '(╯°□°）╯︵ ┻━┻' }
    case 'unflip':
      return { send: '┬─┬ ノ( ゜-゜ノ)' }
    case 'lenny':
      return { send: '( ͡° ͜ʖ ͡°)' }
    case 'clap':
      return args ? { send: `${args.split(/\s+/).join(' 👏 ')} 👏` } : null
    case 'spoiler':
      return args ? { send: `||${args}||` } : null
    case 'giphy':
      return { gif: args }
    default:
      return null
  }
}
