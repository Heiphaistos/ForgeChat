// Infrastructure i18n minimale : français = référence, anglais = traduction partielle
// (toute clé absente de en.ts retombe sur le français).
import { useCallback } from 'react'
import { create } from 'zustand'
import { fr as dfFr, enUS } from 'date-fns/locale'
import { fr, type Key } from './fr.ts'
import { en } from './en.ts'
import { translate, pickLang, type Vars } from './translate.ts'

export type Lang = 'fr' | 'en'
export type { Key }

const STORAGE_KEY = 'fc_lang'
const DICTS: Record<Lang, Readonly<Partial<Record<Key, string>>>> = { fr, en }

// Avant connexion : dernier choix mémorisé, sinon la langue du navigateur.
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return pickLang(saved)
  } catch { /* stockage indisponible : on se rabat sur le navigateur */ }
  return pickLang(typeof navigator !== 'undefined' ? navigator.language : 'fr')
}

interface LangState {
  lang: Lang
  // Accepte le code du réglage serveur (fr, en, es…) : tout ce qui n'est pas fr passe en anglais.
  setLang: (code: string | null | undefined) => void
}

export const useLang = create<LangState>()(set => ({
  lang: initialLang(),
  setLang: code => {
    const lang = pickLang(code)
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* sans mémoire : appliqué pour la session */ }
    if (typeof document !== 'undefined') document.documentElement.lang = lang
    set({ lang })
  },
}))

if (typeof document !== 'undefined') document.documentElement.lang = useLang.getState().lang

// Hors composant (toasts, callbacks) : lit la langue au moment de l'appel.
export function t(key: Key, vars?: Vars): string {
  return translate(DICTS[useLang.getState().lang], fr, key, vars)
}

// Formats régionaux de la langue active (Intl et date-fns). Dans un composant,
// appeler après useT() pour se re-rendre au changement de langue.
export const intlLocale = () => (useLang.getState().lang === 'fr' ? 'fr-FR' : 'en-US')
export const dateLocale = () => (useLang.getState().lang === 'fr' ? dfFr : enUS)

// Dans un composant : se re-rend quand la langue change.
export function useT() {
  const lang = useLang(s => s.lang)
  return useCallback((key: Key, vars?: Vars) => translate(DICTS[lang], fr, key, vars), [lang])
}
