import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { mediaUrl } from '../../api/client'
import { stillUrl } from '../../lib/nameStyle'
import { useProxiedImage } from '../../hooks/useProxiedImage'

export type AvatarAnimation = 'always' | 'hover' | 'never'
const KEY = 'fc.animateAvatars'
const EVENT = 'fc-animate-avatars'

/** Réglage local « Animer les avatars et bannières » (par appareil). */
export function getAvatarAnimation(): AvatarAnimation {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'hover' || v === 'never' ? v : 'always'
  } catch {
    return 'always'
  }
}

export function setAvatarAnimation(v: AvatarAnimation) {
  try { localStorage.setItem(KEY, v) } catch { /* stockage bloqué : réglage gardé pour la session */ }
  window.dispatchEvent(new Event(EVENT))
}

/** Mode effectif : « réduire les animations » (réglage ou système) ramène « toujours » à « au survol ». */
function effective(): AvatarAnimation {
  const mode = getAvatarAnimation()
  const reduce = document.documentElement.getAttribute('data-reduce-motion') === 'true'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return reduce && mode === 'always' ? 'hover' : mode
}

function useAnimationMode(): AvatarAnimation {
  const [mode, setMode] = useState(effective)
  useEffect(() => {
    const update = () => setMode(effective())
    window.addEventListener(EVENT, update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] })
    return () => { window.removeEventListener(EVENT, update); obs.disconnect() }
  }, [])
  return mode
}

/**
 * Image d'avatar ou de bannière : une image animée (`a_<id>.gif`, voir le serveur
 * profile_custom.rs) est remplacée par sa première image selon le réglage — toujours
 * fixe, ou animée seulement au survol. Les autres images passent telles quelles.
 */
/** Image d'un autre site (avatar Discord d'un message importé, webhook) : passe par le proxy du serveur. */
export function isForeignImage(src: string | null | undefined): boolean {
  return !!src && /^https?:\/\//i.test(src) && !src.startsWith(location.origin)
}

export default function AnimatedImg({ src, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src: string | null | undefined }) {
  // Proxy : l'IP du lecteur ne part pas chez le site d'origine, et la CSP n'autorise pas img-src https:.
  const proxied = useProxiedImage(isForeignImage(src) ? src : null)
  if (isForeignImage(src)) src = proxied
  const mode = useAnimationMode()
  const [hover, setHover] = useState(false)
  const still = src ? stillUrl(src) : null
  const animate = !still || mode === 'always' || (mode === 'hover' && hover)
  return (
    <img
      {...rest}
      src={mediaUrl(animate ? src : still)}
      onMouseEnter={still && mode === 'hover' ? () => setHover(true) : rest.onMouseEnter}
      onMouseLeave={still && mode === 'hover' ? () => setHover(false) : rest.onMouseLeave}
    />
  )
}
