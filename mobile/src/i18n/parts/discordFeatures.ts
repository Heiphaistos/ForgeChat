// Fonctions « façon Discord » : non-lu, statut vocal, comptes connectés, forum (préfixe df.).
// fr = référence, en = traduction (une clé absente retombe sur le français).
export const fr = {
  'df.unread.mark': 'Marquer comme non lu',
  'df.voice.title': 'Statut du salon',
  'df.voice.set': 'Définir le statut du salon',
  'df.voice.clear': 'Effacer le statut',
  'df.voice.intro': 'Affiché sous « {name} » dans la liste des salons, pour tout le serveur. Il reste en place quand le salon se vide.',
  'df.voice.label': 'Statut',
  'df.voice.placeholder': 'De quoi parle-t-on ici ?',
  'df.voice.save': 'Enregistrer',
  'df.voice.a11y': 'Statut du salon : {status}',
  'df.accounts.title': 'Comptes connectés',
  'df.accounts.verified': 'vérifié',
  'df.forum.guidelines': 'Consignes de publication',
}

export const en: Partial<Record<keyof typeof fr, string>> = {
  'df.unread.mark': 'Mark as unread',
  'df.voice.title': 'Channel status',
  'df.voice.set': 'Set channel status',
  'df.voice.clear': 'Clear status',
  'df.voice.intro': 'Shown under “{name}” in the channel list, for the whole server. It stays when the channel empties.',
  'df.voice.label': 'Status',
  'df.voice.placeholder': 'What’s happening here?',
  'df.voice.save': 'Save',
  'df.voice.a11y': 'Channel status: {status}',
  'df.accounts.title': 'Connected accounts',
  'df.accounts.verified': 'verified',
  'df.forum.guidelines': 'Post guidelines',
}
