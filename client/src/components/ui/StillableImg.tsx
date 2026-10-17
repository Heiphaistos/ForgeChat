import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'

type GifMode = 'always' | 'hover' | 'never'

// Réglage de l'appli seulement, pas celui du système (voir AnimatedImg).
const reduceMotion = () => document.documentElement.getAttribute('data-reduce-motion') === 'true'

/** « Lire les GIF automatiquement » du compte ; « Réduire les animations » ramène « toujours » à « au survol ». */
function useGifMode(): GifMode {
  const { data } = useQuery<{ gif_autoplay?: string }>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 300_000,
  })
  const [reduce, setReduce] = useState(reduceMotion)
  useEffect(() => {
    const obs = new MutationObserver(() => setReduce(reduceMotion()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] })
    return () => obs.disconnect()
  }, [])
  const mode = data?.gif_autoplay === 'hover' || data?.gif_autoplay === 'never' ? data.gif_autoplay : 'always'
  return reduce && mode === 'always' ? 'hover' : mode
}

/**
 * Image peut-être animée (GIF, emoji animé) : figée sur sa première image (copiée dans un
 * canvas au chargement) selon le réglage, animée au survol en mode « au survol ».
 */
export default function StillableImg({ className = '', style, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const mode = useGifMode()
  const [hover, setHover] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const frozen = mode === 'never' || (mode === 'hover' && !hover)
  const draw = (img: HTMLImageElement) => {
    const c = canvas.current
    if (!c || !img.naturalWidth) return
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d')?.drawImage(img, 0, 0)
  }
  if (mode === 'always') return <img {...rest} className={className} style={style} />
  return (
    <span className="relative inline-block align-middle" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <img {...rest} className={className} style={{ ...style, visibility: frozen ? 'hidden' : undefined }}
        onLoad={e => { draw(e.currentTarget); rest.onLoad?.(e) }} />
      <canvas ref={canvas} aria-hidden className={`absolute inset-0 w-full h-full object-contain ${frozen ? '' : 'hidden'}`} />
    </span>
  )
}
