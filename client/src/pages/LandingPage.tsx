import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Palette, Video, Server, Download, MessageSquare, ChevronRight, Lock } from 'lucide-react'

const RELEASE = 'v3.3.0'
const DL_BASE = 'https://forgechat.heiphaistos.org/downloads'
const INSTALLER_URL = `${DL_BASE}/ForgeChat_3.3.0_x64-setup.exe`
const PORTABLE_URL  = `${DL_BASE}/forgechat-desktop.exe`

const FEATURES = [
  {
    icon: <Lock size={24} />,
    title: 'Chiffrement E2E',
    desc: 'Messages privés chiffrés avec ECDH P-256 + AES-GCM 256-bit. Le serveur ne peut pas lire vos échanges.',
    color: 'text-green-400',
    bg: 'bg-green-400/10 border-green-400/20',
  },
  {
    icon: <Palette size={24} />,
    title: '28 Thèmes',
    desc: 'Personnalisez votre interface : dark, light, cyberpunk, everforest, kanagawa, bloodmoon et bien plus.',
    color: 'text-purple-400',
    bg: 'bg-purple-400/10 border-purple-400/20',
  },
  {
    icon: <Video size={24} />,
    title: 'Audio & Vidéo',
    desc: 'Appels vocaux et vidéo via WebRTC, partage d\'écran, suppression de bruit, canaux vocaux illimités.',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10 border-blue-400/20',
  },
  {
    icon: <Server size={24} />,
    title: 'Self-Hosted',
    desc: 'Hébergez votre propre serveur. Vos données restent chez vous, sous votre contrôle.',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10 border-orange-400/20',
  },
  {
    icon: <Shield size={24} />,
    title: 'Sécurité Renforcée',
    desc: 'Authentification httpOnly cookies, JWT avec révocation, rate limiting, protection CORS stricte.',
    color: 'text-red-400',
    bg: 'bg-red-400/10 border-red-400/20',
  },
  {
    icon: <MessageSquare size={24} />,
    title: 'Riche en fonctions',
    desc: 'Réactions, threads, épingles, mentions, recherche, soundboard, événements, bots, webhooks.',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10 border-yellow-400/20',
  },
]

export default function LandingPage() {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'auto'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="min-h-screen bg-[#0e1117] text-white overflow-x-hidden">

      {/* ── Navigation ──────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0e1117]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="ForgeChat" className="w-8 h-8 rounded-lg" />
          <span className="font-bold text-white text-lg">ForgeChat</span>
          <span className="text-xs text-white/30 ml-1">{RELEASE}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/login"
            className="flex items-center min-h-[44px] px-4 text-sm text-white/70 hover:text-white transition rounded-lg hover:bg-white/5">
            Se connecter
          </Link>
          <Link to="/register"
            className="flex items-center min-h-[44px] px-4 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition">
            S'inscrire
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-40 pb-28 overflow-hidden">
        {/* Glows */}
        <div className="absolute top-32 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
        <div className="absolute top-48 left-1/3 w-64 h-64 rounded-full bg-purple-600/15 blur-[100px] pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
            Open-source · Self-hosted · Chiffré
          </div>

          {/* Title */}
          <h1 className="text-5xl sm:text-7xl font-extrabold leading-none tracking-tight mb-6">
            Communiquez{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              sans compromis
            </span>
          </h1>

          <p className="text-lg sm:text-xl text-white/50 max-w-2xl mx-auto mb-10 leading-relaxed">
            ForgeChat est une plateforme de communication auto-hébergée, chiffrée de bout en bout,
            avec audio/vidéo WebRTC, 28 thèmes, et des messages privés vraiment privés.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <Link to="/register"
              className="flex items-center gap-2 px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-base transition shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/40">
              Créer un compte gratuit
              <ChevronRight size={18} />
            </Link>
            <Link to="/login"
              className="flex items-center gap-2 px-8 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold text-base transition">
              Se connecter
            </Link>
          </div>

          {/* Desktop download callout */}
          <p className="text-sm text-white/30">
            Ou téléchargez le client desktop ↓
          </p>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold text-white mb-3">Tout ce dont vous avez besoin</h2>
          <p className="text-white/40">Conçu pour les équipes qui prennent leur vie privée au sérieux</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(f => (
            <div key={f.title}
              className={`p-6 rounded-2xl border ${f.bg} backdrop-blur-sm hover:scale-[1.02] transition-transform`}>
              <div className={`${f.color} mb-4`}>{f.icon}</div>
              <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Download ────────────────────────────────────────────────── */}
      <section className="relative px-6 pb-28">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="max-w-3xl mx-auto text-center pt-20">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-6">
            <Download size={24} className="text-indigo-400" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">Client Desktop Windows</h2>
          <p className="text-white/40 mb-10">
            Application native Tauri — léger, rapide, tray icon, instance unique.
            <br />Charge directement votre serveur ForgeChat.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
            {/* Installer */}
            <a href={INSTALLER_URL}
              className="flex items-center gap-3 w-full sm:w-auto px-6 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold transition shadow-lg shadow-indigo-600/25 group">
              <div className="p-2 bg-white/15 rounded-lg group-hover:bg-white/20 transition">
                <Download size={18} />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold">Installeur</div>
                <div className="text-xs text-indigo-200/70">ForgeChat_{RELEASE}_x64-setup.exe · 2.7 MB</div>
              </div>
            </a>

            {/* Portable */}
            <a href={PORTABLE_URL}
              className="flex items-center gap-3 w-full sm:w-auto px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold transition group">
              <div className="p-2 bg-white/10 rounded-lg group-hover:bg-white/15 transition">
                <Download size={18} />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold">Portable</div>
                <div className="text-xs text-white/40">forgechat-desktop.exe · 11.4 MB</div>
              </div>
            </a>
          </div>

          <p className="text-xs text-white/25">Windows x64 · Tauri v2 · No telemetry · {RELEASE}</p>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="w-6 h-6 rounded" />
            <span className="text-white/40 text-sm">ForgeChat {RELEASE} · Heiphaistos</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-white/30">
            <a href="https://github.com/Heiphaistos/ForgeChat" target="_blank" rel="noopener noreferrer"
              className="py-2 hover:text-white/60 transition">GitHub</a>
            <a href="https://mydepot.heiphaistos.org/Heiphaistos/ForgeChat" target="_blank" rel="noopener noreferrer"
              className="py-2 hover:text-white/60 transition">Forgejo</a>
            <Link to="/login" className="py-2 hover:text-white/60 transition">Connexion</Link>
            <Link to="/register" className="py-2 hover:text-white/60 transition">Inscription</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
