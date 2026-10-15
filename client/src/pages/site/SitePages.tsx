import { Link } from 'react-router-dom'
import { Bell, Bot, Heart, Lock, MessageSquare, Mic, Palette, Search, Server, Shield, Sparkles, Tv, Video } from 'lucide-react'
import SiteLayout from './SiteLayout'
import Cinema from './Cinema'
import { dateLongue, useDesktopRelease, useMobileRelease } from './releases'
import { useT, type Key } from '../../i18n'

// Icônes des fonctionnalités, dans l'ordre des clés site.feat.N.t / site.feat.N.d.
const FONCTIONS = [MessageSquare, Mic, Video, Tv, Sparkles, Lock, Shield, Palette, Bot, Search, Bell]


export function AccueilPage() {
  return (
    <SiteLayout>
      <Cinema />
    </SiteLayout>
  )
}

export function FonctionnalitesPage() {
  const t = useT()
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">{t('site.features.h1')} <span className="grad">{t('site.features.h1Grad')}</span></h1>
          <p className="site-lead reveal">{t('site.features.lead')}</p>
        </div>
      </section>
      <section className="site-wrap" style={{ paddingBottom: 96 }}>
        <div className="site-grid">
          {FONCTIONS.map((Icone, i) => (
            <div key={i} className="site-card reveal" style={{ '--i': i % 3 } as React.CSSProperties}>
              <div className="ico"><Icone size={22} /></div>
              <h2 className="site-h3">{t(`site.feat.${i}.t` as Key)}</h2>
              <p className="site-muted" style={{ margin: 0 }}>{t(`site.feat.${i}.d` as Key)}</p>
            </div>
          ))}
        </div>
      </section>
    </SiteLayout>
  )
}

export function NouveautesPage() {
  const bureau = useDesktopRelease()
  const mobile = useMobileRelease()
  const t = useT()
  const blocs = [
    { nom: t('site.news.desktop'), r: bureau },
    { nom: t('site.news.mobile'), r: mobile },
  ]
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">{t('site.nav.news')}</h1>
          <p className="site-lead reveal">{t('site.news.lead')}</p>
        </div>
      </section>
      <section className="site-wrap" style={{ paddingBottom: 96, display: 'grid', gap: 16 }}>
        {blocs.map(b => (
          <article key={b.nom} className="site-card reveal">
            <h2 className="site-h3">{b.nom}</h2>
            {b.r ? (
              <>
                <p className="site-muted">{t('site.news.version')} <b>{b.r.version}</b>{dateLongue(b.r.pub_date) ? ` · ${dateLongue(b.r.pub_date)}` : ''}</p>
                <div style={{ whiteSpace: 'pre-line' }}>{b.r.notes || t('site.news.defaultNotes')}</div>
              </>
            ) : <p className="site-muted">{t('site.loading')}</p>}
          </article>
        ))}
      </section>
    </SiteLayout>
  )
}

const FAQ = 8 // clés site.faq.0 à site.faq.7

export function AidePage() {
  const t = useT()
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">{t('site.nav.help')}</h1>
          <p className="site-lead reveal">{t('site.help.lead')} <Link to="/telecharger">{t('site.nav.download')}</Link>{t('site.help.leadEnd')}</p>
        </div>
      </section>
      <section className="site-wrap site-faq" style={{ paddingBottom: 96 }}>
        {Array.from({ length: FAQ }, (_, i) => (
          <details key={i} className="reveal">
            <summary>{t(`site.faq.${i}.q` as Key)}</summary>
            <p>{t(`site.faq.${i}.r` as Key)}</p>
          </details>
        ))}
      </section>
    </SiteLayout>
  )
}

export function AProposPage() {
  const t = useT()
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">{t('site.nav.about')}</h1>
          <p className="site-lead reveal">{t('site.about.lead')}</p>
        </div>
      </section>
      <section className="site-wrap site-grid" style={{ paddingBottom: 96 }}>
        <div className="site-card reveal">
          <div className="ico"><Server size={22} /></div>
          <h2 className="site-h3">Heiphaistos</h2>
          <p className="site-muted" style={{ margin: 0 }}>{t('site.about.heiphaistos')}</p>
        </div>
        <div className="site-card reveal" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="ico"><Heart size={22} /></div>
          <h2 className="site-h3">aerwx</h2>
          <p className="site-muted" style={{ margin: 0 }}>{t('site.about.aerwx')}</p>
        </div>
      </section>
    </SiteLayout>
  )
}
