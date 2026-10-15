// Types et mise en forme des commandes slash d'un serveur (sans dépendance : testable sous node).

export interface CommandOption {
  name: string
  description: string
  type: 'string' | 'integer' | 'boolean' | 'user' | 'role'
  required: boolean
  choices?: { name: string; value: string | number }[]
}

export interface ServerCommand {
  name: string
  description: string
  category: string
  dangerous: boolean
  native: boolean
  options: CommandOption[]
  bot_name: string
  bot_username: string
  bot_avatar: string | null
  default_permission: string
  required_permission: string
  enabled: boolean
  allowed_role_ids: string[]
  allowed: boolean
}

/** `/nom <obligatoire> [facultative]` */
export function commandUsage(c: Pick<ServerCommand, 'name' | 'options'>): string {
  const opts = c.options.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ')
  return `/${c.name}${opts ? ` ${opts}` : ''}`
}
