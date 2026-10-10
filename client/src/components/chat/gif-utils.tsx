import StillableImg from '../ui/StillableImg'

// Message qui n'est QUE l'URL d'un GIF (sélecteur GIF : GIPHY ou Wikimedia via le serveur ; anciens
// messages : Tenor, KLIPY) : affiché comme une image animée plutôt qu'un lien. Seuls ces hôtes https
// sont reconnus (même liste que server/src/handlers/gifs.rs).
const TENOR_GIF = /^https:\/\/media\d*\.tenor\.com\/(?:m\/)?[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,120}\.gif$/
const KLIPY_GIF = /^https:\/\/static\d{0,2}\.klipy\.com\/[A-Za-z0-9._~/-]{1,300}\.(?:gif|webp)$/
const GIPHY_GIF = /^https:\/\/(?:media\d?|i)\.giphy\.com\/media\/[A-Za-z0-9]{1,64}\/[A-Za-z0-9._-]{1,60}\.(?:gif|webp)$/
const COMMONS_GIF = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/[A-Za-z0-9._~%()/-]{1,300}\.gif$/

export function gifMessage(content: string | null | undefined): { url: string; provider: 'Tenor' | 'KLIPY' | 'GIPHY' | 'Wikimedia' } | null {
  const c = content?.trim()
  if (!c || c.length > 400 || c.includes('..')) return null
  if (TENOR_GIF.test(c)) return { url: c, provider: 'Tenor' }
  if (KLIPY_GIF.test(c)) return { url: c, provider: 'KLIPY' }
  if (GIPHY_GIF.test(c)) return { url: c, provider: 'GIPHY' }
  if (COMMONS_GIF.test(c)) return { url: c, provider: 'Wikimedia' }
  return null
}

export function GifMessage({ url, provider }: { url: string; provider: string }) {
  return (
    <div className="mt-1">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <StillableImg src={url} alt={`GIF (${provider})`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-w-[260px] max-h-[220px] rounded" />
      </a>
      <div className="text-[10px] text-fc-muted mt-0.5">GIF via {provider}</div>
    </div>
  )
}
