import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/500.css'
import './site.css'
import { Dust, LogoMark, reduit } from './Cinema'

const NAV = [
  { to: '/', label: 'Accueil', end: true },
  { to: '/fonctionnalites', label: 'Fonctionnalités' },
  { to: '/telecharger', label: 'Télécharger' },
  { to: '/nouveautes', label: 'Nouveautés' },
  { to: '/aide', label: 'Aide & FAQ' },
  { to: '/a-propos', label: 'À propos' },
]

/**
 * Animations d'apparition au défilement : tout élément `.reveal` reçoit `.is-visible` en entrant
 * dans l'écran (IntersectionObserver, aucune bibliothèque). Désactivées par site.css quand le
 * système demande moins d'animations.
 */
function useReveal(key: string) {
  useEffect(() => {
    const pending = () => document.querySelectorAll<HTMLElement>('.site .reveal:not(.is-visible)')
    if (!('IntersectionObserver' in window)) {
      pending().forEach(el => el.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible')
          io.unobserve(e.target)
        }
      }
    }, { rootMargin: '0px 0px -8% 0px' })
    const watch = () => pending().forEach(el => io.observe(el))
    watch()
    // Contenu affiché plus tard (pages chargées à la demande, versions lues sur le serveur).
    const mo = new MutationObserver(watch)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect() }
  }, [key])
}

/**
 * Animations communes à toutes les pages du site : titre du haut de page qui se dévoile, puis ligne
 * de progression des tutoriels qui se remplit au défilement.
 */
function usePageMotion(key: string) {
  useEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      // Le haut de page est animé ici, pas par l'apparition au défilement (.reveal) : sinon GSAP
      // animerait vers l'opacité 0 du .reveal pas encore visible, et le titre resterait caché.
      const haut = gsap.utils.toArray<HTMLElement>('.site-hero .site-h1, .site-hero .site-eyebrow, .site-hero .site-lead, .site-hero .site-actions')
      haut.forEach(el => el.classList.add('is-visible'))
      gsap.fromTo(haut, { y: 40, opacity: 0, filter: 'blur(10px)' }, {
        y: 0, opacity: 1, filter: 'blur(0px)', stagger: 0.1, duration: 0.9, ease: 'expo.out', delay: 0.05, clearProps: 'filter,transform',
      })
      gsap.utils.toArray<HTMLElement>('.site-steps').forEach(ol => {
        gsap.fromTo(ol, { '--fill': 0 }, { '--fill': 1, ease: 'none', scrollTrigger: { trigger: ol, start: 'top 70%', end: 'bottom 60%', scrub: true } })
      })
    })
    // Cartes qui s'inclinent sous la souris (pas au doigt : sur téléphone, rien ne doit gêner le défilement).
    const souris = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const cartes = souris ? gsap.utils.toArray<HTMLElement>('.site-card') : []
    const bouge = (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement, r = el.getBoundingClientRect()
      gsap.to(el, { rotateY: ((e.clientX - r.left) / r.width - 0.5) * 10, rotateX: -((e.clientY - r.top) / r.height - 0.5) * 10, transformPerspective: 800, duration: 0.4 })
    }
    const repos = (e: PointerEvent) => gsap.to(e.currentTarget as HTMLElement, { rotateX: 0, rotateY: 0, duration: 0.6 })
    cartes.forEach(c => { c.addEventListener('pointermove', bouge); c.addEventListener('pointerleave', repos) })
    const t = setTimeout(() => ScrollTrigger.refresh(), 500)
    return () => {
      clearTimeout(t); ctx.revert()
      cartes.forEach(c => { c.removeEventListener('pointermove', bouge); c.removeEventListener('pointerleave', repos) })
    }
  }, [key])
}

export default function SiteLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  useReveal(pathname)
  useEffect(() => { setMenu(false); window.scrollTo(0, 0) }, [pathname])
  // L'app de chat bloque le défilement du document (html/body overflow: hidden, index.css) : le site
  // public, lui, défile normalement. Sans cette classe, rien ne défile au doigt ni à la molette.
  useEffect(() => {
    document.documentElement.classList.add('landing-scroll')
    return () => document.documentElement.classList.remove('landing-scroll')
  }, [])
  usePageMotion(pathname)

  return (
    <div className="site">
      <div className="site-bg" aria-hidden="true"><Dust density={55} /></div>
      <a href="#contenu" className="site-skip">Aller au contenu</a>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand" aria-label="ForgeChat, accueil">
            <LogoMark size={34} />
            <span>Forge<span className="site-brand-chat">Chat</span></span>
          </Link>
          <nav aria-label="Navigation principale" className={`site-nav ${menu ? 'is-open' : ''}`}>
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.end} className="site-nav-link">{n.label}</NavLink>
            ))}
            <Link to="/login" className="site-btn site-btn-ghost site-nav-cta">Se connecter</Link>
          </nav>
          <button
            type="button"
            className="site-menu-btn"
            aria-expanded={menu}
            aria-label={menu ? 'Fermer le menu' : 'Ouvrir le menu'}
            onClick={() => setMenu(m => !m)}
          >
            {menu ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      <main id="contenu" key={pathname} className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="site-wrap site-footer-grid">
          <div>
            <p className="site-footer-brand">ForgeChat</p>
            <p className="site-muted">Messagerie, salons vocaux et appels, hébergée en France.</p>
            <p className="site-muted">
              ForgeChat par <strong>Heiphaistos</strong> · application mobile créée par <strong>aerwx</strong>.
            </p>
          </div>
          <nav aria-label="Télécharger">
            <p className="site-footer-title">Télécharger</p>
            <Link to="/telecharger/windows">Windows</Link>
            <Link to="/telecharger/macos">macOS</Link>
            <Link to="/telecharger/linux">Linux</Link>
            <Link to="/telecharger/android">Android</Link>
            <Link to="/telecharger/iphone">iPhone et iPad</Link>
          </nav>
          <nav aria-label="Informations">
            <p className="site-footer-title">Informations</p>
            <Link to="/aide">Aide & FAQ</Link>
            <Link to="/nouveautes">Nouveautés</Link>
            <Link to="/mentions-legales">Mentions légales</Link>
            <Link to="/confidentialite">Confidentialité</Link>
            <Link to="/cgu">Conditions d'utilisation</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
