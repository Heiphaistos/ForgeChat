// Fonction pure de traduction (sans import : testée par jest).
export type Dict = Readonly<Record<string, string>>
export type Vars = Readonly<Record<string, string | number>>

// Cherche la clé dans la langue active, sinon dans la référence (français),
// sinon renvoie la clé elle-même (jamais de chaîne vide). Remplace ensuite {nom}.
export function translate(dict: Dict, fallback: Dict, key: string, vars?: Vars): string {
  const text = dict[key] || fallback[key] || key
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

// fr si la langue commence par « fr », anglais pour tout le reste (seules langues traduites).
export function pickLang(code: string | null | undefined): 'fr' | 'en' {
  return code?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}
