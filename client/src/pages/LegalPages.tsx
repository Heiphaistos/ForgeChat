import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Logo3D from '../components/Logo3D'
import { useLang, useT } from '../i18n'
import { legalFr, type LegalText } from './legal/fr'
import { legalEn } from './legal/en'

// Mentions légales, politique de confidentialité et CGU propres à forgechat.heiphaistos.org.
// Le texte français (legal/fr.tsx) fait foi ; legal/en.tsx en est la traduction.
// Date de mise à jour écrite en dur : elle ne doit changer que si le texte change.
const TEXTS: Record<'fr' | 'en', LegalText> = { fr: legalFr, en: legalEn }
const useLegal = () => TEXTS[useLang(s => s.lang)]

export function LegalLinks({ className = '' }: { className?: string }) {
  const t = useT()
  return (
    <nav aria-label={t('legal.nav')} className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-fc-muted ${className}`}>
      <Link to="/mentions-legales" className="py-1 hover:text-white transition">{t('legal.notice')}</Link>
      <Link to="/confidentialite" className="py-1 hover:text-white transition">{t('legal.privacy')}</Link>
      <Link to="/cgu" className="py-1 hover:text-white transition">{t('legal.terms')}</Link>
    </nav>
  )
}

function Shell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  const { updated } = useLegal()
  return (
    <div className="h-screen overflow-y-auto bg-fc-bg">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-fc-muted hover:text-white transition">
          <Logo3D size={28} /> ← ForgeChat
        </Link>
        <h1 className="mt-6 text-2xl sm:text-3xl font-bold text-white break-words">{title}</h1>
        <p className="mt-1 text-sm text-fc-muted">{updated}</p>
        {intro && <div className="mt-6 text-sm leading-relaxed text-fc-muted">{intro}</div>}
        {children}
        <LegalLinks className="mt-12 justify-start" />
      </div>
    </div>
  )
}

export function MentionsLegalesPage() {
  const { notice } = useLegal()
  return <Shell title={notice.title}>{notice.body}</Shell>
}

export function ConfidentialitePage() {
  const { privacy } = useLegal()
  return <Shell title={privacy.title} intro={privacy.intro}>{privacy.body}</Shell>
}

export function CguPage() {
  const { terms } = useLegal()
  return <Shell title={terms.title} intro={terms.intro}>{terms.body}</Shell>
}
