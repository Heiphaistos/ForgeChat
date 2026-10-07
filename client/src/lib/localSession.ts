// Bureau (Tauri) : la session vit dans le stockage local de l'appli. Module sans dépendance
// (importé par le client HTTP).

/** Comptes mis de côté sur le bureau (lib/accounts.ts). */
export const TAURI_KEY = 'fc_alt_accounts'

/** Efface la session locale (déconnexion) en gardant les autres comptes mis de côté. */
export function clearLocalSession() {
  const alt = localStorage.getItem(TAURI_KEY)
  localStorage.clear()
  if (alt) localStorage.setItem(TAURI_KEY, alt)
}
