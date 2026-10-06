import { PERM } from './perms'

export type OverrideState = 'allow' | 'deny' | 'inherit'
type Masks = { allow: number; deny: number }

/** Droits réglables par salon (mêmes que client/src/components/modals/ChannelSettingsModal.tsx). */
export const CHANNEL_PERMS: { bit: number; label: string }[] = [
  { bit: PERM.VIEW_CHANNEL, label: 'Voir le salon' },
  { bit: PERM.SEND_MESSAGES, label: 'Envoyer des messages' },
  { bit: PERM.READ_HISTORY, label: "Lire l'historique" },
  { bit: PERM.MANAGE_MESSAGES, label: 'Gérer les messages' },
  { bit: PERM.ATTACH_FILES, label: 'Joindre des fichiers' },
  { bit: PERM.ADD_REACTIONS, label: 'Ajouter des réactions' },
  { bit: PERM.EMBED_LINKS, label: 'Intégrer des liens' },
  { bit: PERM.MENTION_EVERYONE, label: 'Mentionner @everyone' },
  { bit: PERM.CONNECT_VOICE, label: 'Rejoindre la voix' },
  { bit: PERM.SPEAK_VOICE, label: 'Parler' },
  { bit: PERM.STREAM, label: "Partager l'écran / la caméra" },
  { bit: PERM.MUTE_MEMBERS, label: 'Rendre muet' },
  { bit: PERM.DEAFEN_MEMBERS, label: 'Rendre sourd' },
  { bit: PERM.MOVE_MEMBERS, label: 'Déplacer des membres' },
  { bit: PERM.PRIORITY_SPEAKER, label: 'Orateur prioritaire' },
]

// BigInt : STREAM (bit 40) dépasse les 32 bits des opérateurs bit à bit de JS.
const big = (n: number) => BigInt(Math.trunc(n))

export function overrideState(o: Masks, bit: number): OverrideState {
  if ((big(o.allow) & big(bit)) !== 0n) return 'allow'
  if ((big(o.deny) & big(bit)) !== 0n) return 'deny'
  return 'inherit'
}

/** Un bit est autorisé, refusé ou hérité, jamais les deux à la fois. */
export function setOverrideState(o: Masks, bit: number, state: OverrideState): Masks {
  const b = big(bit)
  let allow = big(o.allow) & ~b
  let deny = big(o.deny) & ~b
  if (state === 'allow') allow |= b
  if (state === 'deny') deny |= b
  return { allow: Number(allow), deny: Number(deny) }
}

