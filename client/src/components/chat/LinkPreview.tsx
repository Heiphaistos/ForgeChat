import { useQuery } from '@tanstack/react-query'
import { t as tr } from '../../i18n'
import api from '../../api/client'
import { ExternalLink } from 'lucide-react'
import { isSafeUrl } from '../../utils/safeUrl'
import { previewAllowed } from '../../e2e/channelText'

interface OGData {
  title?: string
  description?: string
  image?: string
  site_name?: string
  url: string
}

interface Props {
  url: string
  /** Message chiffré : aperçu déjà dans le contenu chiffré, pas d'appel à /og (le serveur ne voit pas l'URL). */
  data?: unknown
}

// Première URL http(s) d'un contenu — partagé entre les surfaces qui affichent une preview
const URL_REGEX = /https?:\/\/[^\s<>"]+/g
export function extractFirstUrl(content: string): string | null {
  return content.match(URL_REGEX)?.[0] ?? null
}

/** Aperçu venu d'un contenu chiffré (donc de l'expéditeur) : on ne garde que des chaînes. */
function asOg(v: unknown): OGData | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined)
  const url = str('url')
  return url ? { url, title: str('title'), description: str('description'), image: str('image'), site_name: str('site_name') } : null
}

export default function LinkPreview({ url, data: given }: Props) {
  const query = useQuery<OGData | null>({
    queryKey: ['og', url],
    queryFn: () => api.get(`/og?url=${encodeURIComponent(url)}`).then(r => r.data),
    staleTime: 3_600_000,
    retry: false,
    // Domaine sans aperçu côté serveur : rien n'est demandé (le lien ne part pas).
    enabled: given === undefined && previewAllowed(url),
  })
  const embedded = given === undefined ? undefined : asOg(given)
  const data = given === undefined ? query.data : embedded
  const isLoading = given === undefined && query.isLoading
  const isError = given === undefined && query.isError

  if (isLoading || isError || !data || (!data.title && !data.description && !data.image)) return null

  // Aperçu fourni par l'expéditeur : le lien suit l'URL visible dans le message, pas celle de l'aperçu.
  const target = given === undefined ? data.url : url
  const safeUrl = isSafeUrl(target) ? target : '#'
  // Aperçu fourni par l'expéditeur (`given`) : jamais d'image, elle pourrait venir de son propre
  // serveur et lui livrer l'IP et l'heure de lecture de chaque lecteur (même règle que le mobile).
  const safeImage = given === undefined && data.image && isSafeUrl(data.image) ? data.image : undefined

  return (
    <div
      role="complementary"
      aria-label={tr('hc.lp.aria', { name: data.title ?? data.site_name ?? url })}
      className="mt-2 max-w-full sm:max-w-lg rounded-xl border border-fc-hover bg-fc-channel overflow-hidden"
    >
      {safeImage && (
        <img
          src={safeImage}
          alt={data.title ?? ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="w-full max-h-48 object-cover"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="p-3">
        {data.site_name && (
          <div className="text-xs text-fc-muted uppercase tracking-wide mb-1">{data.site_name}</div>
        )}
        {data.title && (
          <a
            href={safeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-white hover:underline line-clamp-2 block"
          >
            {data.title}
          </a>
        )}
        {data.description && (
          <p className="text-xs text-fc-muted mt-1 line-clamp-2">{data.description}</p>
        )}
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-fc-accent flex items-center gap-1 mt-2"
        >
          <ExternalLink size={10} aria-hidden />
          <span className="truncate">{safeUrl}</span>
        </a>
      </div>
    </div>
  )
}
