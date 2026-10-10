// Transformations appliquées au texte d'un message AVANT son chiffrement et son envoi, sur
// l'appareil (réglages « Nettoyer les liens » et « Convertir les émoticônes »). Module pur,
// sans import : testé par scripts/outgoing.test.mjs.

/** Applique `fn` hors des blocs de code (```…``` et `…`), laissés tels quels. */
function outsideCode(text: string, fn: (s: string) => string): string {
  return text.split(/(```[\s\S]*?```|`[^`\n]+`)/).map((part, i) => (i % 2 ? part : fn(part))).join('')
}

// Paramètres de pistage connus. `si` n'est retiré que chez YouTube et Spotify (ailleurs il peut être utile).
const TRACKERS = /^(utm_\w+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igshid|igsh|_hsenc|_hsmi|ref_src|twclid|ttclid)$/i
const SI_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i

/** Retire les paramètres de pistage d'une adresse ; renvoie l'adresse intacte si rien n'est retiré. */
export function cleanUrl(raw: string): string {
  let u: URL
  try { u = new URL(raw) } catch { return raw }
  const drop = [...u.searchParams.keys()].filter(k => TRACKERS.test(k) || (k === 'si' && SI_HOSTS.test(u.hostname)))
  if (!drop.length) return raw
  drop.forEach(k => u.searchParams.delete(k))
  return u.toString()
}

/** Nettoie toutes les adresses http(s) du texte (ponctuation finale laissée hors de l'adresse). */
export function cleanUrls(text: string): string {
  return outsideCode(text, s => s.replace(/https?:\/\/[^\s<>()]+/g, m => {
    const tail = m.match(/[.,;:!?'"]+$/)?.[0] ?? ''
    return cleanUrl(tail ? m.slice(0, -tail.length) : m) + tail
  }))
}

const EMOTICONS: Record<string, string> = {
  ':)': '🙂', ':-)': '🙂', '(:': '🙂', ':(': '🙁', ':-(': '🙁', ':D': '😃', ':-D': '😃', 'xD': '😆', 'XD': '😆',
  ';)': '😉', ';-)': '😉', ':P': '😛', ':p': '😛', ':-P': '😛', ':-p': '😛', ':O': '😮', ':o': '😮',
  ":'(": '😢', ':|': '😐', ':/': '😕', ':-/': '😕', ':*': '😘', 'B)': '😎', '<3': '❤️', '</3': '💔',
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
// Les plus longues d'abord (« :-) » avant « :) ») ; seulement entre espaces, début ou fin, ou
// avant une ponctuation : « http://a.fr/x » ou « <:emoji:id> » ne sont jamais touchés.
const EMOTICON_RE = new RegExp(
  `(^|\\s)(${Object.keys(EMOTICONS).sort((a, b) => b.length - a.length).map(esc).join('|')})(?=$|\\s|[.,!?])`, 'g')

/** « :) » → 🙂, hors code. */
export function convertEmoticons(text: string): string {
  return outsideCode(text, s => s.replace(EMOTICON_RE, (_m, pre: string, emo: string) => pre + EMOTICONS[emo]))
}

/** Tout ce qui s'applique au texte sortant selon les réglages. */
export function prepareOutgoing(text: string, opts: { cleanUrls: boolean; convertEmoticons: boolean }): string {
  let out = text
  if (opts.cleanUrls) out = cleanUrls(out)
  if (opts.convertEmoticons) out = convertEmoticons(out)
  return out
}
