import type { CSSProperties, ReactNode } from 'react'
import { useLook } from '../../store/nameStyles'
import { DEFAULT_BG, nameCss, pickNameStyle, shownName } from '../../lib/nameStyle'
import { useUxPrefs } from '../../lib/uxPrefs'

/** Fond actuel du thème (variable --fc-bg si un thème la définit), relu au plus toutes les 2 s. */
let bgCache = { at: 0, value: DEFAULT_BG }
function themeBg(): number {
  const now = Date.now()
  if (now - bgCache.at > 2000 && typeof document !== 'undefined') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--fc-bg').trim()
    const m = raw.match(/^#([0-9a-f]{6})$/i)
    bgCache = { at: now, value: m ? parseInt(m[1], 16) : DEFAULT_BG }
  }
  return bgCache.value
}

interface Props {
  userId?: string | null
  /** Nom d'utilisateur (repli si aucun nom d'affichage). */
  name: string
  /** Surnom propre au serveur, prioritaire sur le nom d'affichage. */
  nickname?: string | null
  /** Style de la couleur du rôle (useRoleDecor), dans un serveur. */
  roleStyle?: CSSProperties
  /** Réglage du serveur : la couleur du rôle remplace la couleur perso (vrai par défaut). */
  roleOverrides?: boolean
  /** Affiche l'étiquette perso à côté du nom. */
  withTag?: boolean
  className?: string
  title?: string
  children?: ReactNode
}

/**
 * Pseudo affiché partout (messages, membres, MP, vocal, profils, mentions) : nom
 * d'affichage + style perso, avec la priorité rôle/perso de lib/nameStyle.ts.
 */
export default function UserName({ userId, name, nickname, roleStyle, roleOverrides = true, withTag, className = '', title, children }: Props) {
  const raw = useLook(userId)
  // Webhook ou message importé : posté sous l'id d'un membre mais avec un autre nom.
  const look = raw && (!raw.username || raw.username === name) ? raw : null
  const hasRole = !!roleStyle && Object.keys(roleStyle).length > 0
  const { personal, useRole } = pickNameStyle(look?.name_style ?? null, hasRole, roleOverrides)
  const css = nameCss(personal, themeBg()) as CSSProperties
  const style = useRole ? { ...roleStyle, ...css } : css
  const shimmer = personal?.effect === 'shimmer' ? ' fc-name-shimmer' : ''
  const shown = shownName(name, look?.display_name, nickname)
  // Extras : nom d'utilisateur à côté du pseudo affiché (en-têtes de message et profils).
  const withUsername = useUxPrefs(s => s.showUsername) && withTag && shown !== name
  return (
    <>
      <span className={className + shimmer} style={style} title={title ?? (shown !== name ? name : undefined)}>
        {shown}{children}
      </span>
      {withUsername && <span className="ml-1 text-xs font-normal text-fc-muted">@{name}</span>}
      {withTag && look?.profile_tag && (
        <span className="ml-1 px-1 rounded text-[10px] font-semibold leading-4 bg-fc-hover text-fc-muted align-middle whitespace-nowrap">
          {look.profile_tag}
        </span>
      )}
    </>
  )
}
