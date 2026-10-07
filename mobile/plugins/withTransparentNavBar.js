// @ts-check
const { AndroidConfig, withAndroidStyles } = require('@expo/config-plugins')

/**
 * Barre de navigation Android sans voile blanc : en affichage bord à bord (obligatoire depuis
 * Android 15), le système pose un voile clair sous les boutons de navigation pour garder le
 * contraste ; avec les thèmes sombres de l'app, cela faisait une bande blanche en bas d'écran.
 * Le fond de l'app (couleur du thème) apparaît désormais sous la barre.
 */
/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withTransparentNavBar = (config) =>
  withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      name: 'android:enforceNavigationBarContrast',
      value: 'false',
      targetApi: '29',
      parent: AndroidConfig.Styles.getAppThemeGroup(),
    })
    return cfg
  })

module.exports = withTransparentNavBar
