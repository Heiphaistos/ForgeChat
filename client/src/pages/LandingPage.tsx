import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Shield, Palette, Video, Server, Download, MessageSquare,
  ChevronRight, Lock, Mic, Monitor, Check,
} from 'lucide-react'
import Logo3D from '../components/Logo3D'

const RELEASE = 'v3.12.0'
const DL_BASE = 'https://forgechat.heiphaistos.org/downloads'
const PORTABLE_URL  = `${DL_BASE}/ForgeChat-Portable-${RELEASE}.exe`
const INSTALLER_URL = `${DL_BASE}/ForgeChat-Setup-${RELEASE}.exe`
const DEB_URL       = `${DL_BASE}/ForgeChat-${RELEASE}-amd64.deb`
const APPIMAGE_URL  = `${DL_BASE}/ForgeChat-${RELEASE}-amd64.AppImage`

const FEATURES = [
  {
    icon: <Lock size={22} />,
    title: 'Chiffrement E2E',
    desc: 'Messages privés chiffrés avec ECDH P-256 + AES-GCM 256-bit. Le serveur ne peut pas lire vos échanges.',
    color: 'text-green-400',
    bg: 'bg-green-400/10 border-green-400/20',
  },
  {
    icon: <Video size={22} />,
    title: 'Audio & Vidéo',
    desc: 'Appels vocaux et vidéo WebRTC, partage d\'écran, historique d\'appels, suppression de bruit.',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10 border-blue-400/20',
  },
  {
    icon: <Server size={22} />,
    title: 'Self-Hosted',
    desc: 'Hébergez votre propre serveur. Vos données restent chez vous, sous votre contrôle.',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10 border-orange-400/20',
  },
  {
    icon: <Palette size={22} />,
    title: '28 Thèmes',
    desc: 'Personnalisez votre interface : dark, light, cyberpunk, everforest, kanagawa et bien plus.',
    color: 'text-purple-400',
    bg: 'bg-purple-400/10 border-purple-400/20',
  },
  {
    icon: <Shield size={22} />,
    title: 'Sécurité Renforcée',
    desc: 'Cookies httpOnly, JWT avec révocation, rate limiting, protection CORS stricte, zéro télémétrie.',
    color: 'text-red-400',
    bg: 'bg-red-400/10 border-red-400/20',
  },
  {
    icon: <MessageSquare size={22} />,
    title: 'Riche en fonctions',
    desc: 'Réactions, threads, épingles, mentions, recherche, soundboard, événements, bots, webhooks.',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10 border-yellow-400/20',
  },
]

const STATS = [
  '100 % self-hosted',
  '0 télémétrie',
  '28 thèmes',
  'WebRTC P2P',
  'Open aux bots & webhooks',
]

// ─── Mockup de conversation (pur CSS, aperçu du produit) ─────────────────────
function AppPreview() {
  return (
    <div aria-hidden className="relative z-10 mt-12 sm:mt-16 w-full max-w-3xl mx-auto px-1">
      <div className="rounded-2xl border border-white/10 bg-[#151922] shadow-2xl shadow-indigo-950/50 overflow-hidden text-left">
        {/* Barre de fenêtre */}
        <div className="flex items-center gap-1.5 px-3 sm:px-4 py-2.5 bg-[#10141c] border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
          <span className="ml-2 sm:ml-3 text-[11px] sm:text-xs text-white/30 truncate"># général — Forge des Artisans</span>
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-green-400 flex-shrink-0">
            <Mic size={10} />
            Vocal connecté
          </span>
        </div>

        {/* Messages */}
        <div className="p-3 sm:p-5 space-y-3.5 sm:space-y-4">
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">M</div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs sm:text-sm font-semibold text-white">Morgane</span>
                <span className="text-[10px] text-white/25">14:02</span>
              </div>
              <p className="text-xs sm:text-sm text-white/70 leading-relaxed">La maquette est prête, je vous la partage en vocal ? 🎨</p>
              <div className="flex gap-1.5 mt-1.5">
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-[10px] text-indigo-300">👍 3</span>
                <span className="px-1.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] text-white/50">🔥 2</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">T</div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs sm:text-sm font-semibold text-white">Théo</span>
                <span className="text-[10px] text-white/25">14:03</span>
              </div>
              <p className="text-xs sm:text-sm text-white/70 leading-relaxed">Go — je lance le partage d'écran 🖥️</p>
            </div>
          </div>

          {/* Bandeau appel en cours */}
          <div className="flex items-center gap-2.5 sm:gap-3 rounded-xl border border-green-500/25 bg-green-500/10 px-3 py-2.5">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-green-500/20 text-green-400 flex-shrink-0">
              <Monitor size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs font-medium text-green-300 truncate">Théo partage son écran — 1080p</p>
              <p className="text-[10px] text-white/30">2 participants · 12:47</p>
            </div>
            <span className="flex items-center gap-1 text-[10px] text-white/40 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              En direct
            </span>
          </div>

          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">L</div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs sm:text-sm font-semibold text-white">Lina</span>
                <span className="text-[10px] text-white/25">14:05</span>
                <span className="flex items-center gap-0.5 text-[10px] text-green-400"><Lock size={9} /> E2E</span>
              </div>
              <p className="text-xs sm:text-sm text-white/70 leading-relaxed">Superbe. On épingle la version finale 📌</p>
            </div>
          </div>
        </div>

        {/* Input factice */}
        <div className="mx-3 sm:mx-4 mb-3 sm:mb-4 px-3 sm:px-4 py-2.5 rounded-xl bg-[#0e1117] border border-white/5 text-xs sm:text-sm text-white/25">
          Message #général…
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  useEffect(() => {
    // Classe sur <html> : html ET body sont en overflow:hidden globalement (app chat),
    // et libérer body seul ne débloque pas le défilement tactile mobile
    document.documentElement.classList.add('landing-scroll')
    return () => { document.documentElement.classList.remove('landing-scroll') }
  }, [])

  return (
    <div className="min-h-screen bg-[#0e1117] text-white overflow-x-hidden">

      {/* ── Navigation ──────────────────────────────────────────────── */}
      <nav aria-label="Navigation principale" className="fixed top-0 inset-x-0 z-50 flex items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4 bg-[#0e1117]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <Logo3D size={32} className="rounded-lg" />
          <span className="font-bold text-white text-base sm:text-lg truncate" aria-hidden>ForgeChat</span>
          <span className="hidden sm:inline text-xs text-white/30 ml-1" aria-hidden>{RELEASE}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <Link to="/login"
            className="flex items-center min-h-[44px] px-3 sm:px-4 text-sm text-white/70 hover:text-white transition rounded-lg hover:bg-white/5">
            Se connecter
          </Link>
          <Link to="/register"
            className="flex items-center min-h-[44px] px-3 sm:px-4 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition">
            S'inscrire
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-title" className="relative flex flex-col items-center text-center px-4 sm:px-6 pt-28 sm:pt-40 pb-16 sm:pb-24 overflow-hidden">
        {/* Glows */}
        <div aria-hidden className="absolute top-24 left-1/2 -translate-x-1/2 w-[min(700px,90vw)] h-[400px] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
        <div aria-hidden className="absolute top-48 left-1/3 w-64 h-64 rounded-full bg-purple-600/15 blur-[100px] pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-6 sm:mb-8">
            <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Open-source · Self-hosted · Chiffré
          </div>

          {/* Title */}
          <h1 id="hero-title" className="text-4xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight mb-5 sm:mb-6">
            Communiquez{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              sans compromis
            </span>
          </h1>

          <p className="text-base sm:text-xl text-white/50 max-w-2xl mx-auto mb-8 sm:mb-10 leading-relaxed">
            Plateforme de communication auto-hébergée : messages chiffrés de bout en bout,
            appels audio/vidéo WebRTC, partage d'écran — vos données restent chez vous.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
            <Link to="/register"
              className="flex items-center justify-center gap-2 px-6 sm:px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-base transition shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40">
              Créer un compte gratuit
              <ChevronRight size={18} aria-hidden />
            </Link>
            <a href="#download"
              className="flex items-center justify-center gap-2 px-6 sm:px-8 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold text-base transition">
              <Download size={17} aria-hidden />
              Télécharger pour Windows
            </a>
          </div>
        </div>

        {/* Aperçu produit */}
        <AppPreview />

        {/* Bande de stats */}
        <ul aria-label="Points clés" className="relative z-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-10 sm:mt-14 text-xs sm:text-sm text-white/35">
          {STATS.map(s => (
            <li key={s} className="flex items-center gap-1.5">
              <Check size={13} className="text-indigo-400" aria-hidden />
              {s}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Features ────────────────────────────────────────────────── */}
      <section aria-labelledby="features-title" className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 sm:pb-24">
        <div className="text-center mb-10 sm:mb-14">
          <h2 id="features-title" className="text-2xl sm:text-3xl font-bold text-white mb-3">Tout ce dont vous avez besoin</h2>
          <p className="text-white/40 text-sm sm:text-base">Conçu pour celles et ceux qui prennent leur vie privée au sérieux</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {FEATURES.map(f => (
            <div key={f.title}
              className={`p-5 sm:p-6 rounded-2xl border ${f.bg} backdrop-blur-sm sm:hover:scale-[1.02] transition-transform`}>
              <div className={`${f.color} mb-3 sm:mb-4`} aria-hidden>{f.icon}</div>
              <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Download ────────────────────────────────────────────────── */}
      <section id="download" aria-labelledby="download-title" className="relative px-4 sm:px-6 pb-20 sm:pb-28 scroll-mt-20">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="max-w-3xl mx-auto text-center pt-16 sm:pt-20">
          <div aria-hidden className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-6">
            <Download size={24} className="text-indigo-400" />
          </div>
          <h2 id="download-title" className="text-2xl sm:text-3xl font-bold text-white mb-3">Client Desktop Windows</h2>
          <p className="text-white/40 mb-8 sm:mb-10 text-sm sm:text-base">
            Application native Tauri — légère, rapide, icône de zone de notification.
            <br className="hidden sm:block" /> La version portable se lance sans installation.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch justify-center gap-3 sm:gap-4 mb-8">
            {/* Portable — mis en avant */}
            <a href={PORTABLE_URL} download
              className="relative flex items-center gap-3 sm:w-auto px-5 sm:px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold transition shadow-lg shadow-indigo-600/25 group">
              <span className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full bg-green-500 text-[10px] font-bold text-white uppercase tracking-wide">Recommandé</span>
              <span aria-hidden className="p-2 bg-white/15 rounded-lg group-hover:bg-white/20 transition flex-shrink-0">
                <Download size={18} />
              </span>
              <span className="text-left min-w-0">
                <span className="block text-sm font-bold">Version portable</span>
                <span className="block text-xs text-indigo-200/70 truncate">Sans installation · {RELEASE} · 12 Mo</span>
              </span>
            </a>

            {/* Installeur */}
            <a href={INSTALLER_URL} download
              className="flex items-center gap-3 sm:w-auto px-5 sm:px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold transition group">
              <span aria-hidden className="p-2 bg-white/10 rounded-lg group-hover:bg-white/15 transition flex-shrink-0">
                <Download size={18} />
              </span>
              <span className="text-left min-w-0">
                <span className="block text-sm font-bold">Installeur</span>
                <span className="block text-xs text-white/40 truncate">Setup NSIS · {RELEASE} · 3 Mo</span>
              </span>
            </a>
          </div>

          <p className="text-xs text-white/25" aria-hidden>Windows x64 · Tauri v2 · Zéro télémétrie · {RELEASE}</p>
        </div>
      </section>

      {/* ── Téléchargement Linux ────────────────────────────────────── */}
      <section aria-labelledby="download-linux-title" className="relative px-4 sm:px-6 py-14 sm:py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h2 id="download-linux-title" className="text-xl sm:text-2xl font-bold text-white mb-3">Client Desktop Linux</h2>
          <p className="text-white/40 mb-8 text-sm sm:text-base">
            Debian, Ubuntu et dérivées via le paquet <code className="text-white/60">.deb</code>,
            <br className="hidden sm:block" /> ou n'importe quelle distro via l'AppImage portable.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch justify-center gap-3 sm:gap-4 mb-8">
            <a href={DEB_URL} download
              className="flex items-center gap-3 sm:w-auto px-5 sm:px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold transition group">
              <span aria-hidden className="p-2 bg-white/10 rounded-lg group-hover:bg-white/15 transition flex-shrink-0">
                <Download size={18} />
              </span>
              <span className="text-left min-w-0">
                <span className="block text-sm font-bold">Paquet .deb</span>
                <span className="block text-xs text-white/40 truncate">Debian / Ubuntu · {RELEASE}</span>
              </span>
            </a>

            <a href={APPIMAGE_URL} download
              className="flex items-center gap-3 sm:w-auto px-5 sm:px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold transition group">
              <span aria-hidden className="p-2 bg-white/10 rounded-lg group-hover:bg-white/15 transition flex-shrink-0">
                <Download size={18} />
              </span>
              <span className="text-left min-w-0">
                <span className="block text-sm font-bold">AppImage</span>
                <span className="block text-xs text-white/40 truncate">Portable, toute distro · {RELEASE}</span>
              </span>
            </a>
          </div>

          <p className="text-xs text-white/25" aria-hidden>Linux x64 · Tauri v2 · Zéro télémétrie · {RELEASE}</p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 px-4 sm:px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Logo3D size={24} className="rounded" />
            <span className="text-white/40 text-sm">ForgeChat {RELEASE} · Heiphaistos</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-white/30">
            <a href="https://github.com/Heiphaistos/ForgeChat" target="_blank" rel="noopener noreferrer"
              className="py-2 hover:text-white/60 transition">GitHub</a>
            <Link to="/login" className="py-2 hover:text-white/60 transition">Connexion</Link>
            <Link to="/register" className="py-2 hover:text-white/60 transition">Inscription</Link>
            <a href="https://heiphaistos.org/legal" target="_blank" rel="noopener noreferrer"
              className="py-2 hover:text-white/60 transition">Mentions légales</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
