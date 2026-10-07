// Dictionnaire de référence (français). Toute nouvelle clé s'ajoute ici d'abord ;
// en.ts peut l'omettre, la traduction retombe alors sur le français.
export const fr = {
  // --- Commun ---
  'common.cancel': 'Annuler',
  'common.confirm': 'Confirmer',
  'common.retry': 'Réessayer',
  'common.back': 'Retour',
  'common.close': 'Fermer',
  'common.delete': 'Supprimer',
  'common.error': 'Erreur',
  'common.oops': 'Oups',
  'common.actionFailed': 'Action impossible',
  'common.unread': '{n} non lu',
  'common.unreadMany': '{n} non lus',

  // --- Réglages > Apparence et langue ---
  'appearance.notSynced': 'Réglage non synchronisé',
  'appearance.notSyncedBody': 'Gardé sur cet appareil seulement.\n{error}',
  'appearance.themeSaved': 'Thème enregistré',
  'appearance.reopenForTheme': 'Ferme et rouvre l’app pour appliquer le thème.',
  'appearance.restartAndroid': 'Redémarre l’app pour appliquer les couleurs et la taille du texte.',
  'appearance.restartIos': 'Ferme et rouvre l’app pour appliquer les couleurs et la taille du texte.',
  'appearance.restartNow': 'Redémarrer maintenant',
  'appearance.theme': 'Thème',
  'appearance.themeFooter': 'Mêmes thèmes que sur le web. Le thème est propre à cet appareil.',
  'appearance.themeLabel': 'Thème {name}',
  'appearance.accent': "Couleur d'accent",
  'appearance.accentLabel': 'Accent {color}',
  'appearance.accentTheme': 'Accent du thème',
  'appearance.syncedF': 'Synchronisée avec le web.',
  'appearance.synced': 'Synchronisé avec le web.',
  'appearance.textSize': 'Taille du texte',
  'appearance.textSmall': 'Petit',
  'appearance.textNormal': 'Normal',
  'appearance.textLarge': 'Grand',
  'appearance.textXLarge': 'Très grand',
  'appearance.timeFormat': "Format de l'heure",
  'appearance.time24': '24 heures (14:05)',
  'appearance.time12': '12 heures (02:05 PM)',
  'appearance.streamerFooter': "Masque ton tag et les codes d'invitation à l'écran, comme sur le web.",
  'appearance.streamer': 'Mode streamer',
  'language.title': 'Langue',
  'language.footer': "Langue de l'interface, enregistrée sur ton compte (web et bureau compris).",
}

export type Key = keyof typeof fr
