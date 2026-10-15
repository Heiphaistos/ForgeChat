// Vue détail d'un tutoriel : lecteur vidéo, texte (sous-ensemble HTML sûr, voir htmlToReact), mots-clés.
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Tag } from 'lucide-react'
import api from '../../api/client'
import { intlLocale, useT } from '../../i18n'
import { isSafeUrl } from '../../utils/safeUrl'
import { htmlToReact } from './htmlToReact'
import { categoryIcon, tint, type Tutorial } from './shared'

const BODY = 'text-fc-text leading-relaxed space-y-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-6 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-white [&_h3]:mt-4 [&_h4]:font-semibold [&_h4]:text-white [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_a]:text-fc-accent [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-fc-accent [&_blockquote]:pl-4 [&_blockquote]:text-fc-muted [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:bg-fc-input [&_code]:rounded [&_code]:px-1 [&_pre]:bg-fc-input [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:p-0'

export default function TutorialDetail() {
  const t = useT()
  const nav = useNavigate()
  const { slug = '' } = useParams()
  const q = useQuery({ queryKey: ['tutorial', slug], queryFn: () => api.get<Tutorial>(`/tutorials/${encodeURIComponent(slug)}`).then(r => r.data) })
  const [videoFailed, setVideoFailed] = useState(false)
  const body = useMemo(() => htmlToReact(q.data?.content_html ?? ''), [q.data?.content_html])
  const tu = q.data
  const Icon = tu ? categoryIcon(tu.category.slug) : null

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto bg-fc-chat">
      <div className="sticky top-0 z-30 bg-fc-chat border-b border-fc-hover px-4 h-12 flex items-center">
        <button onClick={() => nav('/tutos')} className="inline-flex items-center gap-2 text-sm text-fc-text hover:text-white"><ArrowLeft size={16} aria-hidden /> {t('tuto.back')}</button>
      </div>
      {q.isLoading && <p className="p-6 text-fc-muted text-sm">{t('common.loading')}</p>}
      {q.isError && (
        <div className="p-6 text-sm text-fc-muted">{t('tuto.error')}{' '}
          <button onClick={() => void q.refetch()} className="text-fc-accent hover:underline">{t('tuto.retry')}</button></div>
      )}
      {tu && Icon && (
        <article className="max-w-4xl mx-auto p-4 md:p-8 space-y-5">
          <header className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-semibold text-white" style={{ background: tint(tu.category.slug) }}><Icon size={13} aria-hidden /> {tu.category.name}</span>
              {tu.group && <span className="px-2.5 py-1 rounded-full bg-fc-hover text-fc-text font-semibold">{tu.group}</span>}
              <time dateTime={tu.created_at} className="text-fc-muted">{new Date(tu.created_at).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}</time>
            </p>
            <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight">{tu.title}</h1>
            {tu.description && <p className="text-fc-text leading-relaxed">{tu.description}</p>}
          </header>
          <div className="rounded-xl overflow-hidden bg-black border border-fc-hover aspect-video flex items-center justify-center">
            {isSafeUrl(tu.video_url) && !videoFailed
              ? <video key={tu.slug} src={tu.video_url} controls preload="metadata" playsInline onError={() => setVideoFailed(true)} className="w-full h-full" />
              : <p className="text-sm text-white/70">{t('tuto.noVideo')}</p>}
          </div>
          {body.length > 0 && <div className={BODY}>{body}</div>}
          {tu.tags.length > 0 && (
            <footer className="flex flex-wrap items-center gap-2 pt-2 border-t border-fc-hover">
              <span className="inline-flex items-center gap-1 text-xs text-fc-muted"><Tag size={12} aria-hidden /> {t('tuto.tags')}</span>
              {tu.tags.map(g => (
                <button key={g} onClick={() => nav(`/tutos?q=${encodeURIComponent(g)}`)} className="px-2.5 py-0.5 rounded-full text-xs bg-fc-channel border border-fc-hover text-fc-text hover:text-white hover:border-fc-accent">{g}</button>
              ))}
            </footer>
          )}
        </article>
      )}
    </div>
  )
}
