// Clés de l'écran « Icône de l'app » (Réglages → Apparence), préfixe appIcon.
// fr = référence, en = traduction (une clé absente retombe sur le français).
export const fr = {
  'appIcon.title': 'Icône de l’app',
  'appIcon.open': 'Icône de l’app',
  'appIcon.openDesc': 'Les icônes du web et du bureau, sur ton écran d’accueil',
  'appIcon.current': 'Icône actuelle : {name}',
  'appIcon.default': 'Icône d’origine',
  'appIcon.preset': 'Icône {n}',
  'appIcon.hint': 'Les mêmes icônes que sur le web et le bureau. Le choix vaut pour cet appareil seulement.',
  'appIcon.noteAndroid':
    'Android : le lanceur remplace l’entrée de l’app. Cela peut prendre quelques secondes, retirer le raccourci de l’écran d’accueil (à remettre) ou fermer brièvement l’app.',
  'appIcon.noteIos': 'iOS : le système affiche une alerte pour confirmer le changement d’icône.',
  'appIcon.applied': 'Icône changée',
  'appIcon.failed': 'Impossible de changer l’icône.\n{error}',
  'appIcon.unsupported': 'Cette version de l’app ne peut pas encore changer d’icône : installe la dernière version.',
}

export const en: Partial<Record<keyof typeof fr, string>> = {
  'appIcon.title': 'App icon',
  'appIcon.open': 'App icon',
  'appIcon.openDesc': 'The web and desktop icons, on your home screen',
  'appIcon.current': 'Current icon: {name}',
  'appIcon.default': 'Original icon',
  'appIcon.preset': 'Icon {n}',
  'appIcon.hint': 'The same icons as on web and desktop. The choice applies to this device only.',
  'appIcon.noteAndroid':
    'Android: the launcher replaces the app entry. This can take a few seconds, remove the home screen shortcut (add it back) or briefly close the app.',
  'appIcon.noteIos': 'iOS: the system shows an alert to confirm the icon change.',
  'appIcon.applied': 'Icon changed',
  'appIcon.failed': 'Could not change the icon.\n{error}',
  'appIcon.unsupported': 'This version of the app cannot change its icon yet: install the latest version.',
}
