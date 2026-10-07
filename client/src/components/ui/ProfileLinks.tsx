import { ExternalLink } from 'lucide-react'

export interface ProfileLink { label: string; url: string }

/** Lien affichable : https uniquement (déjà imposé par le serveur ; garde contre un vieux cache). */
export const safeLink = (l: unknown): l is ProfileLink =>
  !!l && typeof (l as ProfileLink).label === 'string' && typeof (l as ProfileLink).url === 'string' && /^https:\/\/[^\s/]+/i.test((l as ProfileLink).url)

/** Liens du profil (réseaux, site…), ouverts dans un nouvel onglet sans transmettre l'origine. */
export default function ProfileLinks({ links }: { links?: unknown }) {
  const list = Array.isArray(links) ? links.filter(safeLink) : []
  if (!list.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {list.map(l => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={l.url}
          className="inline-flex items-center gap-1 text-xs text-fc-text bg-fc-channel hover:bg-fc-hover rounded px-2 py-1 max-w-full"
        >
          <ExternalLink size={11} className="flex-shrink-0" />
          <span className="truncate">{l.label}</span>
        </a>
      ))}
    </div>
  )
}
