import type { CSSProperties, ReactNode } from 'react'
import { useLook } from '../../store/nameStyles'
import { DEFAULT_BG, cleanStyle, nameClass, nameCss, pickNameStyle, shownName, waveColors } from '../../lib/nameStyle'
import { useUxPrefs } from '../../lib/uxPrefs'
import ClanTag from './ClanTag'

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

/** Tag de clan d'un serveur, tel que renvoyé par GET /servers/:id/members. */
export interface MemberClanTag {
  id: string
  name: string
  color: number
  style?: unknown
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
  /** Style du pseudo propre au serveur (profil de serveur), prioritaire sur le style du compte. */
  serverStyle?: unknown
  /** Marques de clan du serveur, affichées après le pseudo. */
  clanTags?: MemberClanTag[]
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
export default function UserName({ userId, name, nickname, roleStyle, roleOverrides = true, serverStyle, clanTags, withTag, className = '', title, children }: Props) {
  const raw = useLook(userId)
  // Webhook ou message importé : posté sous l'id d'un membre mais avec un autre nom.
  const look = raw && (!raw.username || raw.username === name) ? raw : null
  const hasRole = !!roleStyle && Object.keys(roleStyle).length > 0
  const own = cleanStyle(serverStyle) ?? look?.name_style ?? null
  const { personal, useRole } = pickNameStyle(own, hasRole, roleOverrides)
  const bg = themeBg()
  const css = nameCss(personal, bg) as CSSProperties
  const style = useRole ? { ...roleStyle, ...css } : css
  const fx = nameClass(personal)
  const shown = shownName(name, look?.display_name, nickname)
  // Extras : nom d'utilisateur à côté du pseudo affiché (en-têtes de message et profils).
  const withUsername = useUxPrefs(s => s.showUsername) && withTag && shown !== name
  const wave = personal?.effect === 'wave'
  return (
    <>
      <span
        className={className + fx}
        style={style}
        title={title ?? (shown !== name ? name : undefined)}
        // Glitch : copies décalées via attr(data-text) (texte seul, jamais du HTML).
        data-text={personal?.effect === 'glitch' ? shown : undefined}
      >
        {wave
          ? waveColors(shown, useRole ? null : personal, bg).map((c, i) => (
              <span key={i} style={{ color: c.color, animationDelay: `${(i * 0.08).toFixed(2)}s` }}>{c.ch}</span>
            ))
          : shown}
        {children}
      </span>
      {withUsername && <span className="ml-1 text-xs font-normal text-fc-muted">@{name}</span>}
      {withTag && look?.profile_tag && (
        <ClanTag name={look.profile_tag} style={look.name_style?.tag} fallback="soft" className="ml-1" />
      )}
      {clanTags?.map(tg => (
        <ClanTag key={tg.id} name={tg.name} color={tg.color} style={tg.style} className="ml-1" />
      ))}
    </>
  )
}
