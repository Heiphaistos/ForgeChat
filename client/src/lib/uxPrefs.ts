// Réglages d'affichage, de saisie, d'accessibilité, du mode streamer et « Extras », propres à
// cet appareil (localStorage `fc_ux_prefs`, jamais envoyés au serveur). Appliqués au document
// dès le chargement (attributs et variables CSS de <html>, voir index.css).
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { prepareOutgoing } from '../utils/outgoing'

export type SpoilerMode = 'click' | 'always' | 'moderated'
export type SendKey = 'enter' | 'ctrlEnter'

export interface UxPrefs {
  // Affichage des messages
  spoilers: SpoilerMode
  showReactions: boolean
  showAttachments: boolean
  convertEmoticons: boolean
  // Zone de saisie
  emojiSuggest: boolean
  mentionSuggest: boolean
  markdownPreview: boolean
  sendKey: SendKey
  spellcheck: boolean
  // Mode streamer (actif seulement quand le mode streamer l'est)
  smPersonal: boolean
  smInvites: boolean
  smSounds: boolean
  smNotifications: boolean
  smDmPreviews: boolean
  smIds: boolean
  smAuto: boolean
  // Accessibilité
  saturation: number
  contrast: number
  zoom: number
  underlineLinks: boolean
  readableText: boolean
  roleIcons: boolean
  // Extras
  silentTyping: boolean
  cleanUrls: boolean
  showUsername: boolean
  replyPing: boolean
  messageLogger: boolean
}

export const UX_DEFAULTS: UxPrefs = {
  spoilers: 'click', showReactions: true, showAttachments: true, convertEmoticons: false,
  emojiSuggest: true, mentionSuggest: true, markdownPreview: false, sendKey: 'enter', spellcheck: true,
  smPersonal: true, smInvites: true, smSounds: true, smNotifications: true, smDmPreviews: true, smIds: true, smAuto: false,
  saturation: 100, contrast: 100, zoom: 100, underlineLinks: false, readableText: false, roleIcons: true,
  silentTyping: false, cleanUrls: true, showUsername: false, replyPing: true, messageLogger: false,
}

interface UxState extends UxPrefs {
  set: (p: Partial<UxPrefs>) => void
}

export const useUxPrefs = create<UxState>()(persist(
  set => ({ ...UX_DEFAULTS, set: p => set(p) }),
  { name: 'fc_ux_prefs', storage: createJSONStorage(() => localStorage) },
))

/** Texte d'un message à envoyer, transformé selon les réglages (liens nettoyés, émoticônes), avant chiffrement. */
export const outgoingText = (text: string) => prepareOutgoing(text, useUxPrefs.getState())

const root = () => document.documentElement

/** Mode streamer en cours (réglage du compte, activation auto ou raccourci). */
export const streamerActive = () => root().getAttribute('data-streamer-mode') === 'true'

/** Mode streamer actif ET l'option demandée cochée. */
export const streamerHides = (k: 'smSounds' | 'smNotifications' | 'smDmPreviews') =>
  streamerActive() && useUxPrefs.getState()[k]

/** Écrit les attributs et variables CSS lus par index.css. */
export function applyUxPrefs(p: UxPrefs = useUxPrefs.getState()) {
  const r = root()
  const attr = (k: string, on: boolean) => r.setAttribute(k, String(on))
  attr('data-sm-personal', p.smPersonal)
  attr('data-sm-invites', p.smInvites)
  attr('data-sm-ids', p.smIds)
  attr('data-underline-links', p.underlineLinks)
  attr('data-readable-text', p.readableText)
  // Filtre sur <html> : pas de bloc conteneur créé pour les position:fixed (racine du document).
  const filters = [p.saturation !== 100 && `saturate(${p.saturation}%)`, p.contrast !== 100 && `contrast(${p.contrast}%)`].filter(Boolean)
  r.style.filter = filters.join(' ')
  r.style.zoom = p.zoom === 100 ? '' : String(p.zoom / 100)
}

if (typeof document !== 'undefined') {
  applyUxPrefs()
  useUxPrefs.subscribe(s => applyUxPrefs(s))
}
