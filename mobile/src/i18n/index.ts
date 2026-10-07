// Infrastructure i18n minimale (même principe que le web) : français = référence, anglais =
// traduction partielle (toute clé absente de en.ts retombe sur le français).
import * as SecureStore from 'expo-secure-store'
import { useCallback } from 'react'
import { create } from 'zustand'
import { fr, type Key } from './fr'
import { en } from './en'
import { translate, pickLang, type Vars } from './translate'

export type Lang = 'fr' | 'en'
export type { Key }

const DICTS: Record<Lang, Readonly<Partial<Record<Key, string>>>> = { fr, en }
const KEY = 'fc.lang.v1'
// Même trousseau que les préférences d'apparence (lisible écran verrouillé, après le 1er déverrouillage).
const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  keychainService: 'org.heiphaistos.forgechat.prefs',
}

/** Langue de l'appareil sans dépendance : Intl de Hermes renvoie la locale du système. */
function deviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return 'fr'
  }
}

// Avant connexion : dernier choix mémorisé (compte précédent), sinon la langue de l'appareil.
function initialLang(): Lang {
  try {
    const saved = SecureStore.getItem(KEY, OPTS)
    if (saved) return pickLang(saved)
  } catch {
    /* stockage indisponible : langue de l'appareil */
  }
  return pickLang(deviceLocale())
}

interface LangState {
  lang: Lang
  /** Accepte le code du réglage serveur (fr, en, es…) : tout ce qui n'est pas fr passe en anglais. */
  setLang: (code: string | null | undefined) => void
}

export const useLang = create<LangState>()((set) => ({
  lang: initialLang(),
  setLang: (code) => {
    const lang = pickLang(code)
    try {
      SecureStore.setItem(KEY, lang, OPTS)
    } catch {
      /* sans mémoire : appliqué pour la session */
    }
    set({ lang })
  },
}))

/** Hors composant (alertes, callbacks) : lit la langue au moment de l'appel. */
export function t(key: Key, vars?: Vars): string {
  return translate(DICTS[useLang.getState().lang], fr, key, vars)
}

/** Dans un composant : se re-rend quand la langue change. */
export function useT() {
  const lang = useLang((s) => s.lang)
  return useCallback((key: Key, vars?: Vars) => translate(DICTS[lang], fr, key, vars), [lang])
}
