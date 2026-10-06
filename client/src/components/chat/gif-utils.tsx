// Message qui n'est QUE l'URL d'un GIF (sélecteur GIF : KLIPY via le serveur ; anciens messages :
// Tenor) : affiché comme une image animée plutôt qu'un lien. Seuls ces hôtes https sont reconnus.
const TENOR_GIF = /^https:\/\/media\d*\.tenor\.com\/(?:m\/)?[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,120}\.gif$/
const KLIPY_GIF = /^https:\/\/static\d{0,2}\.klipy\.com\/[A-Za-z0-9._~/-]{1,300}\.(?:gif|webp)$/

export function gifMessage(content: string | null | undefined): { url: string; provider: 'Tenor' | 'KLIPY' } | null {
  const c = content?.trim()
  if (!c || c.length > 400 || c.includes('..')) return null
  if (TENOR_GIF.test(c)) return { url: c, provider: 'Tenor' }
  if (KLIPY_GIF.test(c)) return { url: c, provider: 'KLIPY' }
  return null
}

export function GifMessage({ url, provider }: { url: string; provider: string }) {
  return (
    <div className="mt-1">
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={`GIF (${provider})`} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="max-w-[260px] max-h-[220px] rounded" />
      </a>
      <div className="text-[10px] text-fc-muted mt-0.5">GIF via {provider}</div>
    </div>
  )
}
