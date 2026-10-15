import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Download, RefreshCw } from 'lucide-react'
import { Phone } from './Cinema'
import { artefactUrl, dateLongue, taille, type Artefact, type Release } from './releases'
import { useT } from '../../i18n'

// Briques communes des guides d'installation (guides/fr.tsx, guides/en.tsx) : boutons de
// téléchargement, empreintes, en-tête de plateforme, étapes numérotées.

export function Copier({ texte }: { texte: string }) {
  const t = useT()
  const [ok, setOk] = useState(false)
  return (
    <span className="site-code">
      <span>{texte}</span>
      <button
        type="button"
        className="site-btn site-btn-ghost"
        style={{ padding: '6px 10px' }}
        onClick={() => navigator.clipboard?.writeText(texte).then(() => { setOk(true); setTimeout(() => setOk(false), 1500) })}
        aria-label={t('site.dl.copy')}
      >
        {ok ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </span>
  )
}

export function Bouton({ a, titre, sous, primaire }: { a?: Artefact; titre: string; sous: string; primaire?: boolean }) {
  const t = useT()
  if (!a) return <span className="site-btn site-btn-ghost" aria-disabled="true">{titre}<small>{t('site.dl.soon')}</small></span>
  return (
    <a href={artefactUrl(a)} download className={`site-btn ${primaire ? 'site-btn-primary' : 'site-btn-ghost'}`}>
      <Download size={18} />
      <span>{titre}<small>{[sous, taille(a)].filter(Boolean).join(' · ')}</small></span>
    </a>
  )
}

export function Empreinte({ a }: { a?: Artefact }) {
  const t = useT()
  if (!a?.sha256) return null
  return <p className="site-muted" style={{ fontSize: '.8rem', wordBreak: 'break-all' }}>{t('site.dl.sha', { h: a.sha256 })}</p>
}

export function MisesAJour({ children }: { children: ReactNode }) {
  const t = useT()
  return (
    <section className="site-section reveal">
      <div className="site-card">
        <div className="ico"><RefreshCw size={22} /></div>
        <h2 className="site-h3">{t('site.dl.updates')}</h2>
        <div className="site-muted">{children}</div>
      </div>
    </section>
  )
}

type Os = 'windows' | 'macos' | 'linux' | 'mobile' | 'web'

/** Fenêtre de bureau aux couleurs du système (boutons Windows, feux macOS, barre GNOME). */
function Fenetre({ os }: { os: Os }) {
  return (
    <div className={`dl-win dl-win-${os}`} aria-hidden="true">
      <div className="dl-win-bar">
        {os === 'macos' ? <span className="dl-feux"><i /><i /><i /></span> : null}
        <span className="dl-win-titre">ForgeChat</span>
        {os !== 'macos' ? <span className="dl-win-btn"><i /><i /><i /></span> : null}
      </div>
      <div className="dl-win-body">
        <div className="dl-win-rail"><b /><b /><b /></div>
        <div className="dl-win-chat">
          {['70%', '52%', '84%', '40%'].map((w, i) => <span key={i} className="dl-win-line" style={{ width: w, '--i': i } as React.CSSProperties} />)}
          <span className="dl-win-input" />
        </div>
      </div>
    </div>
  )
}

export function EnTete({ titre, release, os, children }: { titre: string; release: Release | null; os: Os; children: ReactNode }) {
  const t = useT()
  const date = dateLongue(release?.pub_date)
  return (
    <section className="site-hero">
      <div className="site-wrap dl-hero">
        <div>
          <Link to="/telecharger" className="site-eyebrow">{t('site.dl.allPlatforms')}</Link>
          <h1 className="site-h1 reveal">{t('site.dl.for')} <span className="grad">{titre}</span></h1>
          {release && <p className="site-muted reveal">{t('site.dl.version', { v: release.version })}{date ? t('site.dl.published', { date }) : ''}</p>}
          <div className="site-actions reveal">{children}</div>
        </div>
        <div className="dl-visuel">{os === 'mobile' ? <Phone className="dl-phone" /> : <Fenetre os={os} />}</div>
      </div>
    </section>
  )
}

export function Etapes({ children }: { children: ReactNode }) {
  return <ol className="site-steps">{children}</ol>
}
export function Etape({ titre, children }: { titre: string; children?: ReactNode }) {
  return <li className="reveal"><h3 className="site-h3">{titre}</h3>{children}</li>
}
