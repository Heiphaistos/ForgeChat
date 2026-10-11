// Réglages d'affichage et de saisie propres à cet appareil, mêmes que le web
// (client/src/lib/uxPrefs.ts) : spoilers, réactions, pièces jointes repliées, émoticônes,
// saisie silencieuse, liens nettoyés, réponse avec mention. Jamais envoyés au serveur.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { secureStateStorage } from '@/lib/secureStorage'
import { prepareOutgoing } from '@/lib/outgoing'

export type SpoilerMode = 'click' | 'always'

export interface UxPrefs {
  spoilers: SpoilerMode
  showReactions: boolean
  showAttachments: boolean
  convertEmoticons: boolean
  /** Les autres ne voient pas « … est en train d'écrire ». */
  silentTyping: boolean
  cleanUrls: boolean
  /** Réponse dans un salon : notifier l'auteur cité (choix par défaut, modifiable à chaque réponse). */
  replyPing: boolean
}

export const UX_DEFAULTS: UxPrefs = {
  spoilers: 'click', showReactions: true, showAttachments: true, convertEmoticons: false,
  silentTyping: false, cleanUrls: true, replyPing: true,
}

export const useUxPrefs = create<UxPrefs & { set: (p: Partial<UxPrefs>) => void }>()(
  persist((set) => ({ ...UX_DEFAULTS, set: (p) => set(p) }), {
    name: 'fc.ux.prefs.v1',
    storage: createJSONStorage(() => secureStateStorage),
    partialize: ({ set: _s, ...rest }) => rest,
  }),
)

/** Texte d'un message à envoyer, transformé selon les réglages, AVANT chiffrement. */
export const outgoingText = (text: string) => prepareOutgoing(text, useUxPrefs.getState())
