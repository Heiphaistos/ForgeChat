import type { Key } from '@/i18n'
import { PERM } from './perms'

export type OverrideState = 'allow' | 'deny' | 'inherit'
type Masks = { allow: number; deny: number }

/** Droits réglables par salon (mêmes que client/src/components/modals/ChannelSettingsModal.tsx). */
export const CHANNEL_PERMS: { bit: number; label: Key }[] = [
  { bit: PERM.VIEW_CHANNEL, label: 'serverSettings.perm.viewChannel' },
  { bit: PERM.SEND_MESSAGES, label: 'serverSettings.perm.send' },
  { bit: PERM.READ_HISTORY, label: 'serverSettings.perm.readHistory' },
  { bit: PERM.MANAGE_MESSAGES, label: 'serverSettings.perm.manageMessages' },
  { bit: PERM.ATTACH_FILES, label: 'serverSettings.perm.attach' },
  { bit: PERM.ADD_REACTIONS, label: 'serverSettings.perm.react' },
  { bit: PERM.EMBED_LINKS, label: 'serverSettings.perm.embed' },
  { bit: PERM.MENTION_EVERYONE, label: 'serverSettings.perm.mentionEveryone' },
  { bit: PERM.CONNECT_VOICE, label: 'serverSettings.perm.connect' },
  { bit: PERM.SPEAK_VOICE, label: 'serverSettings.perm.speak' },
  { bit: PERM.STREAM, label: 'serverSettings.perm.stream' },
  { bit: PERM.MUTE_MEMBERS, label: 'serverSettings.perm.mute' },
  { bit: PERM.DEAFEN_MEMBERS, label: 'serverSettings.perm.deafen' },
  { bit: PERM.MOVE_MEMBERS, label: 'serverSettings.perm.move' },
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

