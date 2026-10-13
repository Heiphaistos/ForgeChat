// Activité affichée sur un profil (« Joue à », « Écoute »…) : icône et libellé traduit,
// partagés par la carte de profil (UserPopup) et la page de profil (UserProfilePage).
import type { Key } from '../i18n'

export const ACTIVITY_ICONS: Record<string, string> = {
  playing: '🎮',
  listening: '🎵',
  watching: '📺',
  streaming: '📡',
  competing: '🏆',
}

const LABELS: Record<string, Key> = {
  playing: 'act.playing',
  listening: 'act.listening',
  watching: 'act.watching',
  streaming: 'act.streaming',
  competing: 'act.competing',
}

/** Clé du libellé ; type inconnu = « Activité » (jamais le code brut). */
export const activityLabel = (type: string): Key => LABELS[type] ?? 'act.other'
