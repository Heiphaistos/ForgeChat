// @ts-check

/**
 * Dépôt GitHub (« propriétaire/dépôt ») où sont publiées les releases de la bêta : l'app y vérifie,
 * au démarrage, s'il existe une version plus récente. Fixé au build (FORGECHAT_UPDATES_REPO).
 * Seulement pour la bêta (production) ; absent = vérification désactivée.
 * @param {string} appEnv
 * @param {string | undefined} value
 * @returns {string | null}
 */
function updatesRepo(appEnv, value) {
  const repo = (value ?? '').trim()
  if (appEnv !== 'production' || !repo) return null
  const [owner, name, ...rest] = repo.split('/')
  const ok =
    rest.length === 0 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner ?? '') &&
    /^[A-Za-z0-9._-]{1,100}$/.test(name ?? '') &&
    name !== '.' &&
    name !== '..'
  if (!ok) throw new Error(`FORGECHAT_UPDATES_REPO invalide : « ${repo} » (attendu : propriétaire/dépôt GitHub)`)
  return repo
}

module.exports = { updatesRepo }
