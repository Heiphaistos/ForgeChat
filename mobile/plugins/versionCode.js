// @ts-check

/**
 * versionCode Android dérivé de la version publique X.Y.Z : X×10000 + Y×100 + Z (1.2.3 → 10203).
 * Il augmente donc à chaque nouvelle version, ce qu'Android exige pour installer une mise à jour
 * par-dessus l'ancienne (APK téléchargé depuis GitHub). Y et Z : 0 à 99.
 * @param {string} version
 * @returns {number}
 */
function versionCodeOf(version) {
  const m = /^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/.exec(version)
  if (!m) throw new Error(`version invalide : « ${version} » (attendu X.Y.Z, Y et Z ≤ 99)`)
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
}

module.exports = { versionCodeOf }
