/** Lien vers un message trouvé par la recherche globale (salon, DM ou groupe). */
export function messageLink(m: { id: string; kind?: string; channel_id: string; server_id?: string | null }): string {
  if (m.kind === 'dm') return `/dms/${m.channel_id}?highlight=${m.id}`
  if (m.kind === 'group') return `/dms/groups/${m.channel_id}?highlight=${m.id}`
  return `/servers/${m.server_id}/channels/${m.channel_id}?highlight=${m.id}`
}
