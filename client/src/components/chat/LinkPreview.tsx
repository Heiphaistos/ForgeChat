import { useQuery } from '@tanstack/react-query'
import api from '../../api/client'
import { ExternalLink } from 'lucide-react'

interface OGData {
  title?: string
  description?: string
  image?: string
  site_name?: string
  url: string
}

interface Props {
  url: string
}

/** Valide qu'une URL est safe à utiliser dans un src/href */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export default function LinkPreview({ url }: Props) {
  const { data, isLoading, isError } = useQuery<OGData | null>({
    queryKey: ['og', url],
    queryFn: () => api.get(`/og?url=${encodeURIComponent(url)}`).then(r => r.data),
    staleTime: 5 * 60_000,
    retry: false,
  })

  if (isLoading || isError || !data || (!data.title && !data.description && !data.image)) return null

  // Valider les URLs pour prévenir les injections javascript:
  const safeUrl = isSafeUrl(data.url) ? data.url : '#'
  const safeImage = data.image && isSafeUrl(data.image) ? data.image : undefined

  return (
    <div className="mt-2 border-l-4 border-fc-accent bg-fc-channel rounded-r-lg overflow-hidden max-w-lg">
      <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="flex gap-3 p-3 hover:bg-fc-hover/40 transition group">
        {safeImage && (
          <img
            src={safeImage}
            alt=""
            className="w-20 h-16 object-cover rounded flex-shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <div className="flex flex-col justify-center min-w-0 flex-1 gap-0.5">
          {data.site_name && (
            <span className="text-xs text-fc-muted uppercase tracking-wide">{data.site_name}</span>
          )}
          {data.title && (
            <span className="text-sm font-semibold text-white group-hover:underline line-clamp-1">{data.title}</span>
          )}
          {data.description && (
            <span className="text-xs text-fc-muted line-clamp-2">{data.description}</span>
          )}
          <span className="text-xs text-fc-accent flex items-center gap-1 mt-0.5">
            <ExternalLink size={10} />
            <span className="truncate">{safeUrl}</span>
          </span>
        </div>
      </a>
    </div>
  )
}
