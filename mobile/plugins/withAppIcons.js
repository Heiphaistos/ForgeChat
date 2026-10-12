// @ts-check
const fs = require('fs')
const path = require('path')
const { AndroidConfig, IOSConfig, withAndroidManifest, withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins')

/**
 * Icônes d'application alternatives (Réglages → Apparence → Icône de l'app ; modules/app-icon).
 * Les 50 variantes du web et du bureau, générées par scripts/generate-app-icons.py dans
 * assets/app-icons/ (sources 1024 px + variants.json) ; les tailles finales sont tirées ici.
 *
 * Android : une <activity-alias> par variante (désactivée), qui cible MainActivity et porte son
 * icône. MainActivity reste l'entrée du lanceur avec l'icône d'origine. Choisir une variante active
 * son alias et désactive MainActivity (PackageManager) : le lanceur remplace l'entrée. Les alias
 * recopient les autres intent-filter de MainActivity (schéma forgechat://, App Links), sinon les liens
 * ne s'ouvriraient plus pendant qu'une variante est choisie.
 *
 * iOS : CFBundleAlternateIcons (Info.plist) et PNG nommés AppIcon<Nom>@2x/@3x(~ipad) dans le bundle ;
 * setAlternateIconName les applique (iOS affiche alors une alerte système).
 */

const ASSETS = 'assets/app-icons'
const VARIANTS_FILE = require.resolve('../assets/app-icons/variants.json')

/** @typedef {{ type: 'solid' | 'gradient' | 'circle', colors: string[], base?: string }} Background */
/** @typedef {{ id: string, name: string, background: Background }} Variant */

/** @returns {Variant[]} */
function readVariants(file = VARIANTS_FILE) {
  /** @type {Variant[]} */
  const variants = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const v of variants) {
    if (!/^Preset[1-9][0-9]?$/.test(v.name)) throw new Error(`withAppIcons : nom d'icône invalide « ${v.name} »`)
    if (!v.background.colors.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) throw new Error(`withAppIcons : couleur invalide (${v.name})`)
  }
  return variants
}

// ─── Android ────────────────────────────────────────────────────────────────

/** Nom de ressource Android (minuscules) : Preset12 → app_icon_preset12. */
const resName = (/** @type {string} */ name) => `app_icon_${name.toLowerCase()}`
/** Nom de l'alias, relatif au paquet comme MainActivity (le module natif le reconnaît à ce préfixe). */
const aliasName = (/** @type {string} */ name) => `.AppIcon${name}`

/** @param {any} filter */
const isLauncherFilter = (filter) =>
  (filter.action ?? []).some((/** @type {any} */ a) => a.$['android:name'] === 'android.intent.action.MAIN') &&
  (filter.category ?? []).some((/** @type {any} */ c) => c.$['android:name'] === 'android.intent.category.LAUNCHER')

/**
 * Ajoute (ou remplace) les alias des variantes dans le manifeste.
 * @param {AndroidConfig.Manifest.AndroidManifest} manifest
 * @param {Variant[]} variants
 */
function applyAndroidManifest(manifest, variants) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)
  const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest)
  const others = (main['intent-filter'] ?? []).filter((f) => !isLauncherFilter(f))
  /** @type {any} */
  const application = app
  const names = new Set(variants.map((v) => aliasName(v.name)))
  const kept = (application['activity-alias'] ?? []).filter((/** @type {any} */ a) => !names.has(a.$['android:name']))
  application['activity-alias'] = [
    ...kept,
    ...variants.map((v) => ({
      $: {
        'android:name': aliasName(v.name),
        'android:enabled': 'false',
        'android:exported': 'true',
        'android:icon': `@mipmap/${resName(v.name)}`,
        'android:roundIcon': `@mipmap/${resName(v.name)}`,
        'android:targetActivity': main.$['android:name'],
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
          category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
        },
        ...structuredClone(others),
      ],
    })),
  ]
  return manifest
}

/**
 * Fond de l'icône adaptative : couleur unie, dégradé diagonal ou disque sur le gris de l'app.
 * @param {Background} bg
 */
function backgroundDrawable(bg) {
  const ns = 'xmlns:android="http://schemas.android.com/apk/res/android"'
  const [from, to] = bg.colors
  // angle 315 : du coin haut gauche au coin bas droit, comme les PNG (et le bureau).
  const gradient = `<gradient android:angle="315" android:startColor="${from}" android:endColor="${to}" />`
  if (bg.type === 'solid') return `<shape ${ns}>\n  <solid android:color="${from}" />\n</shape>\n`
  if (bg.type === 'gradient') return `<shape ${ns}>\n  ${gradient}\n</shape>\n`
  // Disque de 80 dp sur la couche de 108 dp : il dépasse juste la zone visible d'un masque rond.
  return [
    `<layer-list ${ns}>`,
    `  <item><shape><solid android:color="${bg.base}" /></shape></item>`,
    `  <item android:top="14dp" android:bottom="14dp" android:left="14dp" android:right="14dp">`,
    `    <shape android:shape="oval">${gradient}</shape>`,
    '  </item>',
    '</layer-list>',
    '',
  ].join('\n')
}

/** @param {string} name */
const adaptiveIconXml = (name) =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    `  <background android:drawable="@drawable/${resName(name)}_background" />`,
    `  <foreground android:drawable="@mipmap/${resName(name)}_foreground" />`,
    // Icône à thème (Android 13+) : seule la transparence compte, l'avant-plan convient.
    `  <monochrome android:drawable="@mipmap/${resName(name)}_foreground" />`,
    '</adaptive-icon>',
    '',
  ].join('\n')

// Densités Android : icône classique 48 dp (Android 7), couche adaptative 108 dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

/**
 * PNG redimensionné depuis une source 1024 px (même outil et même cache que l'icône principale).
 * @param {string} projectRoot @param {string} src @param {number} size @param {string} cacheType
 */
async function resized(projectRoot, src, size, cacheType) {
  const { generateImageAsync } = require('@expo/image-utils')
  const { source } = await generateImageAsync(
    { projectRoot, cacheType },
    { src: path.join(projectRoot, src), width: size, height: size, resizeMode: 'cover', backgroundColor: 'transparent' },
  )
  return source
}

/** @param {string} projectRoot @param {Variant[]} variants */
async function writeAndroidResources(projectRoot, variants) {
  const res = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res')
  const write = (/** @type {string} */ rel, /** @type {string | Buffer} */ data) => {
    fs.mkdirSync(path.dirname(path.join(res, rel)), { recursive: true })
    fs.writeFileSync(path.join(res, rel), data)
  }
  for (const v of variants) {
    const r = resName(v.name)
    write(`drawable/${r}_background.xml`, backgroundDrawable(v.background))
    write(`mipmap-anydpi-v26/${r}.xml`, adaptiveIconXml(v.name))
    for (const [dpi, scale] of Object.entries(DENSITIES)) {
      write(`mipmap-${dpi}/${r}.png`, await resized(projectRoot, `${ASSETS}/${v.id.replace(':', '-')}.png`, 48 * scale, `fc-app-icon-legacy-${v.name}`))
      write(`mipmap-${dpi}/${r}_foreground.png`, await resized(projectRoot, `${ASSETS}/${v.id.replace(':', '-')}-foreground.png`, 108 * scale, `fc-app-icon-fg-${v.name}`))
    }
  }
}

// ─── iOS ────────────────────────────────────────────────────────────────────

/** Fichiers de chaque variante : suffixe → côté en pixels (iPhone 60 pt, iPad 76 et 83,5 pt). */
const IOS_FILES = { '@2x.png': 120, '@3x.png': 180, '@2x~ipad.png': 152, '-83.5@2x~ipad.png': 167 }
const iosBase = (/** @type {string} */ name) => `AppIcon${name}`

/**
 * Déclare les icônes alternatives (le nom passé à setAlternateIconName est celui de la variante).
 * @param {Record<string, any>} plist
 * @param {Variant[]} variants
 */
function applyInfoPlist(plist, variants) {
  for (const [key, files] of /** @type {const} */ ([
    ['CFBundleIcons', (/** @type {string} */ n) => [iosBase(n)]],
    ['CFBundleIcons~ipad', (/** @type {string} */ n) => [iosBase(n), `${iosBase(n)}-83.5`]],
  ])) {
    const icons = { ...(plist[key] ?? {}) }
    // Icône principale : le catalogue d'images AppIcon d'Expo, inchangé.
    icons.CFBundlePrimaryIcon ??= { CFBundleIconName: 'AppIcon', CFBundleIconFiles: ['AppIcon'], UIPrerenderedIcon: false }
    icons.CFBundleAlternateIcons = Object.fromEntries(
      variants.map((v) => [v.name, { CFBundleIconFiles: files(v.name), UIPrerenderedIcon: false }]),
    )
    plist[key] = icons
  }
  return plist
}

/** @param {string} projectRoot @param {string} projectName @param {Variant[]} variants */
async function writeIosFiles(projectRoot, projectName, variants) {
  const dir = path.join(projectRoot, 'ios', projectName, 'AppIcons')
  fs.mkdirSync(dir, { recursive: true })
  for (const v of variants) {
    for (const [suffix, size] of Object.entries(IOS_FILES)) {
      const png = await resized(projectRoot, `${ASSETS}/${v.id.replace(':', '-')}.png`, size, `fc-app-icon-ios-${v.name}`)
      fs.writeFileSync(path.join(dir, `${iosBase(v.name)}${suffix}`), png)
    }
  }
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withAppIcons = (config) => {
  const variants = readVariants()
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyAndroidManifest(cfg.modResults, variants)
    return cfg
  })
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      await writeAndroidResources(cfg.modRequest.projectRoot, variants)
      return cfg
    },
  ])
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults = /** @type {any} */ (applyInfoPlist(cfg.modResults, variants))
    return cfg
  })
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      await writeIosFiles(cfg.modRequest.projectRoot, cfg.modRequest.projectName ?? '', variants)
      return cfg
    },
  ])
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults
    const projectName = cfg.modRequest.projectName ?? ''
    for (const v of variants) {
      for (const suffix of Object.keys(IOS_FILES)) {
        const filepath = `${projectName}/AppIcons/${iosBase(v.name)}${suffix}`
        if (!project.hasFile(filepath)) {
          IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath, groupName: projectName, project, isBuildFile: true, verbose: false })
        }
      }
    }
    return cfg
  })
  return config
}

module.exports = withAppIcons
module.exports.readVariants = readVariants
module.exports.applyAndroidManifest = applyAndroidManifest
module.exports.applyInfoPlist = applyInfoPlist
module.exports.backgroundDrawable = backgroundDrawable
module.exports.adaptiveIconXml = adaptiveIconXml
