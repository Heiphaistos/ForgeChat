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
    staleTime: 3_600_000,
    retry: false,
  })

  if (isLoading || isError || !data || (!data.title && !data.description && !data.image)) return null

  const safeUrl = isSafeUrl(data.url) ? data.url : '#'
  const safeImage = data.image && isSafeUrl(data.image) ? data.image : undefined

  return (
    <div className="mt-2 max-w-lg rounded-xl border border-fc-hover bg-fc-channel overflow-hidden">
      {safeImage && (
        <img
          src={safeImage}
          alt={data.title ?? ''}
          loading="lazy"
          decoding="async"
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
          <ExternalLink size={10} />
          <span className="truncate">{safeUrl}</span>
        </a>
      </div>
    </div>
  )
}
