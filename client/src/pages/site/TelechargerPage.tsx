import type { ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Apple, Globe, Monitor, ShieldCheck, Smartphone, Terminal } from 'lucide-react'
import SiteLayout from './SiteLayout'
import { plateformeDuVisiteur, useDesktopRelease, useMobileRelease, type Plateforme } from './releases'
import { guidesFr } from './guides/fr'
import { guidesEn } from './guides/en'
import { useLang, useT, type Key } from '../../i18n'

// Résumé de chaque carte : clé site.dl.sum.<id>.
const PLATEFORMES: { id: Plateforme; nom: string | Key; icone: ReactNode }[] = [
  { id: 'windows', nom: 'Windows', icone: <Monitor size={22} /> },
  { id: 'macos', nom: 'macOS', icone: <Apple size={22} /> },
  { id: 'linux', nom: 'Linux', icone: <Terminal size={22} /> },
  { id: 'android', nom: 'Android', icone: <Smartphone size={22} /> },
  { id: 'iphone', nom: 'site.iphoneIpad', icone: <Apple size={22} /> },
  { id: 'web', nom: 'site.browser', icone: <Globe size={22} /> },
]

const GUIDES = { fr: guidesFr, en: guidesEn }

export function TelechargerPlateformePage() {
  const { plateforme } = useParams()
  const Page = GUIDES[useLang(s => s.lang)][plateforme as Plateforme]
  if (!Page) return <Navigate to="/telecharger" replace />
  return <SiteLayout><Page /></SiteLayout>
}

export default function TelechargerPage() {
  const mienne = plateformeDuVisiteur()
  const bureau = useDesktopRelease()
  const mobile = useMobileRelease()
  const t = useT()
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <span className="site-eyebrow"><ShieldCheck size={16} /> {t('site.dl.eyebrow')}</span>
          <h1 className="site-h1 reveal">{t('site.nav.download')} <span className="grad">ForgeChat</span></h1>
          <p className="site-lead reveal">
            {t('site.dl.lead')}
            {bureau && <> {t('site.dl.desktopVersion', { v: bureau.version })}</>}
            {mobile && <> {t('site.dl.mobileVersion', { v: mobile.version })}</>}
          </p>
        </div>
      </section>
      <section className="site-wrap" style={{ paddingBottom: 96 }}>
        <div className="site-grid">
          {PLATEFORMES.map((p, i) => (
            <Link
              key={p.id}
              to={`/telecharger/${p.id}`}
              className={`site-card site-card-link reveal ${p.id === mienne ? 'is-mine' : ''}`}
              style={{ '--i': i } as React.CSSProperties}
            >
              <div className="ico">{p.icone}</div>
              <h2 className="site-h3">{p.nom.startsWith('site.') ? t(p.nom as Key) : p.nom} {p.id === mienne && <span className="site-badge">{t('site.dl.yours')}</span>}</h2>
              <p className="site-muted" style={{ margin: 0 }}>{t(`site.dl.sum.${p.id}` as Key)}</p>
            </Link>
          ))}
        </div>
      </section>
    </SiteLayout>
  )
}
