// @ts-check
const { withAndroidManifest } = require('@expo/config-plugins')

/**
 * Bêta : retire le schéma `exp+<slug>` que le plugin d'expo-dev-client ajoute toujours au prebuild
 * (même exclu de l'autolinking). Résidu du client de développement : aucun lien `exp+…://` ne doit
 * ouvrir l'app publique.
 */

/** Retire les <data android:scheme="exp+…"> des intent-filters de toutes les activités. */
function removeDevClientSchemes(manifest) {
  for (const app of manifest.manifest.application ?? []) {
    for (const activity of app.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        if (filter.data) filter.data = filter.data.filter((d) => !String(d.$?.['android:scheme'] ?? '').startsWith('exp+'))
      }
    }
  }
  return manifest
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withoutDevClientScheme = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = removeDevClientSchemes(cfg.modResults)
    return cfg
  })

module.exports = Object.assign(withoutDevClientScheme, { removeDevClientSchemes })
