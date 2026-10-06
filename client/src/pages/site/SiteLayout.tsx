import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import './site.css'

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

export default function SiteLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [menu, setMenu] = useState(false)
  useReveal(pathname)
  useEffect(() => { setMenu(false); window.scrollTo(0, 0) }, [pathname])

  return (
    <div className="site">
      <a href="#contenu" className="site-skip">Aller au contenu</a>
      <header className="site-header">
        <div className="site-wrap site-header-row">
          <Link to="/" className="site-brand" aria-label="ForgeChat, accueil">
            <img src="/icons/icon-192.png" alt="" width={32} height={32} />
            <span>ForgeChat</span>
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

      <main id="contenu">{children}</main>

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
