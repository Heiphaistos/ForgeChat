/**
 * Données de la barre de saisie, identiques au client web (MessageInput, EmojiPicker, StickerPicker,
 * QuickReplies) pour que les deux clients envoient et comprennent les mêmes messages.
 */
import { t, type Key } from '@/i18n'

export interface EmojiCategory {
  label: string
  emojis: readonly string[]
}

/** Catégories du sélecteur d'emoji du web (mêmes emojis, même ordre). */
export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    label: "😀 Smileys",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩",
      "😘", "😗", "😚", "😙", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨",
      "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕",
      "🤢", "🤮", "🤧", "🥵", "🥶", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "😕", "😟", "🙁", "☹️", "😮",
      "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓",
      "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️", "💩", "🤡", "👻", "👽", "🤖",
    ],
  },
  {
    label: "👋 Gestes",
    emojis: [
      "👋", "🤚", "✋", "🖖", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️",
      "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🙏", "💪", "👀", "👂", "👃", "👅", "👄",
    ],
  },
  {
    label: "❤️ Cœurs",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖",
      "💘", "💝", "💟", "🔥", "✨", "⭐", "🌟", "💫", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇",
    ],
  },
  {
    label: "🐶 Animaux",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
      "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞",
      "🐜", "🦟", "🦗", "🕷️", "🦂", "🐢", "🦎", "🐍", "🐊", "🦕", "🦖", "🐙", "🦑", "🦐", "🦞", "🦀",
      "🐡", "🐟", "🐠", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🐆", "🦓", "🦍", "🦧", "🦣", "🐘", "🦛",
      "🦏", "🐪", "🐫", "🦒", "🦘", "🦬",
    ],
  },
  {
    label: "🍎 Nourriture",
    emojis: [
      "🍏", "🍎", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍈", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🍆",
      "🥑", "🥦", "🥕", "🌽", "🍄", "🧄", "🧅", "🥔", "🍞", "🥐", "🍕", "🍔", "🍟", "🌭", "🍿", "🧂",
      "🥚", "🍳", "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌮", "🌯", "🍱", "🍣", "🍜", "🍝", "🍛", "🥗",
      "🍲", "🍙", "🍚", "🍘", "🍥", "🧁", "🍰", "🎂", "🍭", "🍫", "🍩", "🍪", "☕", "🍵", "🧃", "🥤",
      "🧋", "🍺", "🍻", "🥂", "🍷", "🥃", "🍹",
    ],
  },
  {
    label: "⚽ Sports",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸", "🥊", "🥋", "⛳", "🎣", "🤿",
      "🏋️", "🤼", "🤸", "🏊", "🚴", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🎯", "🎳", "🎮", "🎰", "🧩",
      "🎲", "♟️", "🎭", "🎨", "🎬", "🎤", "🎧", "🎸", "🎹", "🥁", "🎺", "🎷", "🎻",
    ],
  },
  {
    label: "🌍 Nature",
    emojis: [
      "🌸", "🌺", "🌻", "🌹", "🌷", "🌼", "🌱", "🌿", "🍀", "🍁", "🍂", "🍃", "🌾", "🌲", "🌳", "🌴",
      "🌵", "🎋", "🍄", "🌊", "🌀", "🌈", "❄️", "☃️", "⛄", "🌤️", "⛅", "☁️", "🌧️", "⛈️", "🌩️", "🌨️",
      "💨", "💧", "💦", "⚡", "🔥", "🌙", "⭐", "🌟", "☀️", "🌍", "🌎", "🌏", "🌋", "⛰️", "🏔️", "🏕️",
      "🏖️", "🏜️", "🏝️", "🌃", "🌆", "🌇", "🌉",
    ],
  },
  {
    label: "🚗 Objets",
    emojis: [
      "🚗", "🚕", "🚙", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "✈️", "🚀", "🛸", "🚁", "🛶", "⛵", "🚢",
      "🛥️", "🚤", "🛳️", "⛴️", "🚂", "🚃", "🚄", "🚅", "🚆", "🚇", "🚊", "🚉", "🛺", "🚲", "🛴", "🛵",
      "🏍️", "💺", "⌚", "📱", "💻", "🖥️", "🖨️", "⌨️", "🖱️", "📷", "📸", "📹", "🎥", "📽️", "📺", "📻",
      "🎙️", "📡", "🔋", "💡", "🔦", "🕯️", "💰", "💳", "💎", "⚗️", "🔭", "🔬", "🧲", "🔑", "🗝️", "🔒",
      "🔓", "🔨", "🪓", "⛏️", "🔧", "🔩", "🪛", "🧰", "🗡️", "⚔️", "🛡️", "🎁", "🎀", "🎊", "🎉", "🎈",
      "🎂", "🎗️", "🏮", "🧧", "✉️", "📬", "📮", "📦", "📫", "📚", "📖", "📝", "✏️", "🖊️", "🖋️", "📌",
      "📍", "📎", "🖇️", "✂️",
    ],
  },
]

/** Emojis récents gardés (comme le web). */
export const RECENT_EMOJIS_MAX = 18

export interface GlobalSticker {
  id: string
  emoji: string
  name: string
  category: string
}

/** Stickers « globaux » du web (emoji en grand), disponibles partout. */
export const GLOBAL_STICKERS: readonly GlobalSticker[] = [
  { id: 'g1', emoji: "👍", name: 'thumbsup', category: 'Réactions' },
  { id: 'g2', emoji: "👎", name: 'thumbsdown', category: 'Réactions' },
  { id: 'g3', emoji: "❤️", name: 'heart', category: 'Réactions' },
  { id: 'g4', emoji: "😂", name: 'lol', category: 'Réactions' },
  { id: 'g5', emoji: "😮", name: 'wow', category: 'Réactions' },
  { id: 'g6', emoji: "😢", name: 'sad', category: 'Réactions' },
  { id: 'g7', emoji: "😡", name: 'angry', category: 'Réactions' },
  { id: 'g8', emoji: "🎉", name: 'party', category: 'Réactions' },
  { id: 'g9', emoji: "🔥", name: 'fire', category: 'Réactions' },
  { id: 'g10', emoji: "💯", name: 'hundred', category: 'Réactions' },
  { id: 'g11', emoji: "🐱", name: 'cat', category: 'Animaux' },
  { id: 'g12', emoji: "🐶", name: 'dog', category: 'Animaux' },
  { id: 'g13', emoji: "🐸", name: 'frog', category: 'Animaux' },
  { id: 'g14', emoji: "🦊", name: 'fox', category: 'Animaux' },
  { id: 'g15', emoji: "🐼", name: 'panda', category: 'Animaux' },
  { id: 'g16', emoji: "🦁", name: 'lion', category: 'Animaux' },
  { id: 'g17', emoji: "🐧", name: 'penguin', category: 'Animaux' },
  { id: 'g18', emoji: "🦋", name: 'butterfly', category: 'Animaux' },
  { id: 'g19', emoji: "🐙", name: 'octopus', category: 'Animaux' },
  { id: 'g20', emoji: "🦄", name: 'unicorn', category: 'Animaux' },
]

/** Expiration d'un message (secondes) : mêmes choix que le web ; envoyée en `expires_at_seconds`. */
/** `label` : clé de traduction (src/i18n). */
export const MESSAGE_TTL_OPTIONS: readonly { label: Key; seconds: number | null }[] = [
  { label: 'composer.ttlNone', seconds: null },
  { label: 'composer.ttl5m', seconds: 300 },
  { label: 'composer.ttl1h', seconds: 3600 },
  { label: 'composer.ttl24h', seconds: 86400 },
  { label: 'composer.ttl7d', seconds: 604800 },
]

export interface QuickReply {
  id: string
  label: string
  content: string
}

/** Réponses rapides par défaut du web (tant que l'utilisateur n'en a pas enregistré). */
export const DEFAULT_QUICK_REPLIES: readonly QuickReply[] = [
  { id: '1', get label() { return t('sw.qr.thanksLabel') }, get content() { return t('sw.qr.thanks') } },
  { id: '2', get label() { return t('sw.qr.okLabel') }, get content() { return t('sw.qr.ok') } },
  { id: '3', get label() { return t('sw.qr.soonLabel') }, get content() { return t('sw.qr.soon') } },
]
