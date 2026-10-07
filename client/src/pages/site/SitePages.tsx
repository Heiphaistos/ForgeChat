import { Link } from 'react-router-dom'
import { Bell, Bot, Heart, Lock, MessageSquare, Mic, Palette, Search, Server, Shield, Sparkles, Tv, Video } from 'lucide-react'
import SiteLayout from './SiteLayout'
import Cinema from './Cinema'
import { dateFr, useDesktopRelease, useMobileRelease } from './releases'

const FONCTIONS = [
  { icone: <MessageSquare size={22} />, titre: 'Salons et messages privés', texte: 'Serveurs, salons texte, fils, forums, réactions, épingles, mentions, réponses, messages éphémères, messages vocaux.' },
  { icone: <Mic size={22} />, titre: 'Salons vocaux', texte: 'Rejoignez un salon vocal d’un clic, depuis le web, le bureau ou le téléphone : tout le monde s’entend, quel que soit l’appareil.' },
  { icone: <Video size={22} />, titre: 'Appels vidéo et partage d’écran', texte: 'Appels privés et de groupe, caméra, partage d’écran jusqu’en 4K, flou d’arrière-plan, clips des 30 dernières secondes, même depuis Android.' },
  { icone: <Tv size={22} />, titre: 'Regarder ensemble', texte: 'Une vidéo YouTube synchronisée pour tout le salon vocal : lecture, pause et avance partagées, comme si vous étiez dans le même canapé.' },
  { icone: <Sparkles size={22} />, titre: 'Tout le premium, gratuit', texte: 'Ce qui est payant ailleurs est offert ici : super réactions, décorations d’avatar, thème et profil par serveur, envois de 500 Mo, emojis et sons de tous vos serveurs.' },
  { icone: <Lock size={22} />, titre: 'Vie privée', texte: 'Aucun pistage, aucune publicité. Toutes les conversations et tous les appels chiffrés de bout en bout, serveur hébergé en France.' },
  { icone: <Shield size={22} />, titre: 'Sécurité', texte: 'Double authentification, sessions révocables, appareils connectés visibles, protection contre le hameçonnage des liens.' },
  { icone: <Palette size={22} />, titre: 'Des dizaines de thèmes', texte: 'Sombre, clair, AMOLED, cyberpunk, everforest, kanagawa… les mêmes sur le web, le bureau et le téléphone.' },
  { icone: <Bot size={22} />, titre: 'Bots et webhooks', texte: 'Automatisez vos serveurs : webhooks, bots, flux RSS, notifications GitHub, tickets, classements.' },
  { icone: <Search size={22} />, titre: 'Recherche', texte: 'Retrouvez n’importe quel message, fichier ou lien, avec filtres par auteur, salon et date.' },
  { icone: <Bell size={22} />, titre: 'Notifications fines', texte: 'Par serveur, par salon, par conversation ; mode Ne pas déranger ; @everyone ignorable.' },
]


export function AccueilPage() {
  return (
    <SiteLayout>
      <Cinema />
    </SiteLayout>
  )
}

export function FonctionnalitesPage() {
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">Tout ce qu’il faut <span className="grad">pour discuter</span></h1>
          <p className="site-lead reveal">Les mêmes fonctions sur le web, le bureau et le téléphone.</p>
        </div>
      </section>
      <section className="site-wrap" style={{ paddingBottom: 96 }}>
        <div className="site-grid">
          {FONCTIONS.map((f, i) => (
            <div key={f.titre} className="site-card reveal" style={{ '--i': i % 3 } as React.CSSProperties}>
              <div className="ico">{f.icone}</div>
              <h2 className="site-h3">{f.titre}</h2>
              <p className="site-muted" style={{ margin: 0 }}>{f.texte}</p>
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
  const blocs = [
    { nom: 'Applications de bureau (Windows, macOS, Linux)', r: bureau },
    { nom: 'Applications mobiles (Android, iPhone)', r: mobile },
  ]
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">Nouveautés</h1>
          <p className="site-lead reveal">La version web se met à jour en continu ; voici les dernières versions des applications.</p>
        </div>
      </section>
      <section className="site-wrap" style={{ paddingBottom: 96, display: 'grid', gap: 16 }}>
        {blocs.map(b => (
          <article key={b.nom} className="site-card reveal">
            <h2 className="site-h3">{b.nom}</h2>
            {b.r ? (
              <>
                <p className="site-muted">Version <b>{b.r.version}</b>{dateFr(b.r.pub_date) ? ` · ${dateFr(b.r.pub_date)}` : ''}</p>
                <div style={{ whiteSpace: 'pre-line' }}>{b.r.notes || 'Corrections et améliorations.'}</div>
              </>
            ) : <p className="site-muted">Chargement…</p>}
          </article>
        ))}
      </section>
    </SiteLayout>
  )
}

const FAQ = [
  { q: 'ForgeChat est-il gratuit ?', r: 'Oui, entièrement, sans publicité ni abonnement.' },
  { q: 'Pourquoi Windows, macOS ou Android affichent-ils un avertissement à l’installation ?', r: 'Les applications ne sont pas signées par un certificat payant ni distribuées par les stores. Chaque guide d’installation explique comment passer l’avertissement ; l’empreinte SHA-256 de chaque fichier est affichée pour vérifier qu’il n’a pas été modifié.' },
  { q: 'Comment mettre à jour ?', r: 'Rien à faire : web, Windows, macOS, Linux et Android vérifient eux-mêmes les nouvelles versions et proposent de les installer. Sur iPhone, la web app est toujours à jour, et AltStore / SideStore proposent les nouvelles versions de l’app native.' },
  { q: 'Mes messages sont-ils lus ?', r: 'Non. Aucun pistage ni analyse. Toutes les conversations et tous les appels sont chiffrés de bout en bout, obligatoirement : le serveur ne peut pas les lire. Voir la politique de confidentialité.' },
  { q: 'Puis-je utiliser le même compte partout ?', r: 'Oui : web, bureau et mobile partagent le même compte, en temps réel.' },
  { q: 'L’app iPhone expire au bout de 7 jours ?', r: 'Avec un identifiant Apple gratuit, Apple limite la signature à 7 jours. AltStore et SideStore la renouvellent automatiquement. La web app, elle, n’expire jamais.' },
  { q: 'L’app de bureau Linux reste blanche', r: 'Lancez « ForgeChat (mode compatibilité) » depuis le menu : rendu logiciel, fonctionne sans carte graphique. Le journal est dans ~/.local/share/org.heiphaistos.forgechat/forgechat.log.' },
  { q: 'J’ai oublié mon mot de passe', r: 'Sur la page de connexion, « Mot de passe oublié » : un lien de réinitialisation est envoyé par e-mail.' },
]

export function AidePage() {
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">Aide &amp; FAQ</h1>
          <p className="site-lead reveal">Les réponses aux questions les plus fréquentes. Les guides d’installation sont sur la page <Link to="/telecharger">Télécharger</Link>.</p>
        </div>
      </section>
      <section className="site-wrap site-faq" style={{ paddingBottom: 96 }}>
        {FAQ.map(f => (
          <details key={f.q} className="reveal">
            <summary>{f.q}</summary>
            <p>{f.r}</p>
          </details>
        ))}
      </section>
    </SiteLayout>
  )
}

export function AProposPage() {
  return (
    <SiteLayout>
      <section className="site-hero">
        <div className="site-wrap">
          <h1 className="site-h1 reveal">À propos</h1>
          <p className="site-lead reveal">ForgeChat est une messagerie communautaire indépendante, gratuite et hébergée en France.</p>
        </div>
      </section>
      <section className="site-wrap site-grid" style={{ paddingBottom: 96 }}>
        <div className="site-card reveal">
          <div className="ico"><Server size={22} /></div>
          <h2 className="site-h3">Heiphaistos</h2>
          <p className="site-muted" style={{ margin: 0 }}>Créateur de ForgeChat : serveur, application web et applications de bureau Windows, macOS et Linux.</p>
        </div>
        <div className="site-card reveal" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="ico"><Heart size={22} /></div>
          <h2 className="site-h3">aerwx</h2>
          <p className="site-muted" style={{ margin: 0 }}>Créateur de l’application mobile ForgeChat pour Android et iPhone : appels, salons vocaux, partage d’écran, tout le chat dans la poche. Merci à lui.</p>
        </div>
      </section>
    </SiteLayout>
  )
}
