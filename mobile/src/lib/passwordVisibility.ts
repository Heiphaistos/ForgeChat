/**
 * Bouton « œil » des champs de mot de passe (composant PasswordField).
 * Logique pure, testée : libellé, icône, et quand remasquer.
 */
import { t } from '@/i18n'

/** Libellé d'accessibilité du bouton selon l'état actuel du champ. */
export const eyeLabel = (visible: boolean) => t(visible ? 'auth.hidePassword' : 'auth.showPassword')

/** Icône : œil barré quand le texte est en clair (un appui le masquera). */
export const eyeIcon = (visible: boolean): 'eye-off-outline' | 'eye-outline' => (visible ? 'eye-off-outline' : 'eye-outline')

/** Le champ repasse masqué dès que l'app n'est plus au premier plan (arrière-plan, sélecteur d'apps). */
export const maskOnAppState = (state: string) => state !== 'active'
