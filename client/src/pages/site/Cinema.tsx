import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Bell, Download, Hash, Lock, MessageSquare, Mic, Pause, Play, Send, Server, Volume2, VolumeX } from 'lucide-react'
import './cinema.css'

gsap.registerPlugin(ScrollTrigger)
// Barre d'adresse mobile qui apparaît/disparaît : ne pas tout recalculer à chaque fois.
ScrollTrigger.config({ ignoreMobileResize: true })

export const reduit = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Accueil « cinéma » : reprend scène par scène la vidéo de présentation (logo, mots géants, chapitres
 * numérotés, téléphone qui s'anime, puces de fonctionnalités, thèmes, « sous le capot », final).
 * Sans animation (préférence système), toutes les scènes s'affichent dans leur état final : le CSS
 * montre tout, seul GSAP cache puis révèle.
 */

/* ───────────────────────────── Fond : poussière lumineuse ───────────────────────────── */

export function Dust({ density = 70 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || reduit()) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let w = 0, h = 0, raf = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const pts = Array.from({ length: density }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3,
      vx: (Math.random() - 0.5) * 0.00012, vy: -Math.random() * 0.00018 - 0.00004, a: Math.random() * 0.6 + 0.2,
      gold: Math.random() < 0.18,
    }))
    const frame = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random() }
        if (p.x < -0.02) p.x = 1.02; else if (p.x > 1.02) p.x = -0.02
        ctx.globalAlpha = p.a
        ctx.fillStyle = p.gold ? '#e8c46a' : '#9fa8ff'
        ctx.beginPath(); ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2); ctx.fill()
      }
      raf = requestAnimationFrame(frame)
    }
    // Rien ne tourne quand la page est cachée ou le canvas hors de l'écran.
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf)
      if (e.isIntersecting) raf = requestAnimationFrame(frame)
    })
    io.observe(canvas)
    window.addEventListener('resize', resize)
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener('resize', resize) }
  }, [density])
  return <canvas ref={ref} className="cn-dust" aria-hidden="true" />
}

/* ───────────────────────────── Logo ───────────────────────────── */

export function LogoMark({ size = 72 }: { size?: number }) {
  return (
    <span className="cn-logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size * 0.56} height={size * 0.56}>
        <rect x="8" y="10" width="48" height="34" rx="9" fill="rgba(255,255,255,.18)" />
        <rect x="16" y="22" width="32" height="7" rx="3.5" fill="#fff" />
        <path d="M26 44 L32 53 L38 44 Z" fill="rgba(255,255,255,.18)" />
      </svg>
    </span>
  )
}

/* ───────────────────────────── Téléphone de démonstration ───────────────────────────── */

type Msg = { qui: string; c: string; h: string; txt: ReactNode }
const MSGS: Msg[] = [
  { qui: 'Max', c: '#3b82c4', h: '20:40', txt: 'Les nouveaux salons vocaux sont en ligne' },
  { qui: 'Alex', c: '#d0453a', h: '20:44', txt: 'Testé sur mon Pixel, ça tourne nickel' },
  { qui: 'Théo', c: '#e07a26', h: '20:51', txt: 'La màj d’hier est trop propre' },
  { qui: 'Sam', c: '#1f9e7a', h: '20:58', txt: 'Le mode sombre sur Android, enfin' },
  { qui: 'Léa', c: '#e0245e', h: '21:02', txt: 'Quelqu’un chaud pour un vocal ce soir ?' },
  { qui: 'Hugo', c: '#4255c4', h: '21:03', txt: <>Grave <span className="cn-mention">@Léa</span> on se cale dans le salon vocal</> },
]

export function Phone({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`cn-phone ${className}`} style={style} aria-hidden="true">
      <div className="cn-phone-bar"><span>21:04</span><i className="cn-cam" /><span className="cn-sig"><b /><b /><b /></span></div>
      <div className="cn-phone-top"><Hash size={15} /> gaming <span className="cn-phone-acc" /></div>
      <div className="cn-notif"><span className="cn-notif-ico"><MessageSquare size={12} /></span><div><b>ForgeChat · #gaming</b><small>Léa t’a mentionné : on lance à 21 h ?</small></div></div>
      <div className="cn-phone-msgs">
        {MSGS.map(m => (
          <div key={m.qui} className="cn-pm">
            <span className="cn-av" style={{ background: m.c }}>{m.qui[0]}</span>
            <div><b style={{ color: m.c === '#d0453a' ? '#f07a6f' : undefined }}>{m.qui}</b> <small>{m.h}</small><p>{m.txt}</p></div>
          </div>
        ))}
        <div className="cn-pm cn-pm-poll">
          <span className="cn-av" style={{ background: '#8e44ad' }}>N</span>
          <div>
            <b>Nina</b> <small>21:04</small><p>Je lance un sondage :</p>
            <div className="cn-poll">
              <p>On joue à quoi ?</p>
              <div className="cn-poll-row"><i className="cn-poll-bar" style={{ '--v': '68%' } as CSSProperties} /><span>Coop survie</span><em>68%</em></div>
              <div className="cn-poll-row"><i className="cn-poll-bar" style={{ '--v': '32%' } as CSSProperties} /><span>Course</span><em>32%</em></div>
            </div>
            <span className="cn-react">🔥 5</span>
          </div>
        </div>
        <p className="cn-typing">Max est en train d’écrire<span>.</span><span>.</span><span>.</span></p>
      </div>
      <div className="cn-phone-input"><span>+</span> Message #gaming <i><Send size={13} /></i></div>
      <div className="cn-home" />
    </div>
  )
}

/* ───────────────────────────── Scènes ───────────────────────────── */

function Hero() {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' } })
      tl.from('.cn-hero .cn-logo', { scale: 0, rotate: -25, duration: 1.1, ease: 'back.out(1.8)' })
        .from('.cn-hero-title .cn-ch', { yPercent: 120, opacity: 0, stagger: 0.04, duration: 0.9 }, '-=0.5')
        .from('.cn-hero .cn-pill', { y: 16, opacity: 0, duration: 0.6 }, '-=0.5')
        .from('.cn-hero .cn-lead, .cn-hero .cn-actions', { y: 24, opacity: 0, stagger: 0.12, duration: 0.8 }, '-=0.4')
        .from('.cn-streak', { scaleX: 0, opacity: 0, stagger: 0.08, duration: 1.2 }, 0.2)
      // En quittant le héros : le titre s'éloigne.
      gsap.to('.cn-hero-inner', {
        yPercent: -18, opacity: 0.2, scale: 0.94, ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom top', scrub: true },
      })
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <section ref={root} className="cn-hero">
      <Dust />
      <i className="cn-streak" style={{ top: '22%' }} /><i className="cn-streak" style={{ top: '64%', left: '40%' }} /><i className="cn-streak" style={{ top: '80%', left: '8%' }} />
      <div className="cn-hero-inner">
        <LogoMark size={96} />
        <h1 className="cn-hero-title" aria-label="ForgeChat">
          <span aria-hidden="true">{[...'Forge'].map((c, i) => <span key={i} className="cn-ch">{c}</span>)}</span>
          <span aria-hidden="true" className="cn-grad">{[...'Chat'].map((c, i) => <span key={i} className="cn-ch">{c}</span>)}</span>
        </h1>
        <p className="cn-pill"><i /> Web · Windows · macOS · Linux · Android · iPhone</p>
        <p className="cn-lead">Ta messagerie, partout. Salons, vocal, vidéo, partage d’écran. Gratuit, sans pistage, hébergé en France.</p>
        <div className="cn-actions">
          <Link to="/register" className="site-btn site-btn-primary">Créer un compte gratuit</Link>
          <Link to="/telecharger" className="site-btn site-btn-ghost"><Download size={18} /> Télécharger</Link>
        </div>
      </div>
      <div className="cn-scroll" aria-hidden="true"><span /></div>
    </section>
  )
}

function Trailer() {
  const root = useRef<HTMLElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [enLecture, setEnLecture] = useState(false)
  const [muet, setMuet] = useState(true)
  useEffect(() => {
    const v = video.current
    if (!v) return
    // Lecture automatique (muette) seulement visible à l'écran et si le système accepte l'animation.
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduit()) v.play().then(() => setEnLecture(true)).catch(() => {})
      else { v.pause(); setEnLecture(false) }
    }, { threshold: 0.35 })
    io.observe(v)
    return () => io.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      gsap.fromTo('.cn-trailer-frame', { scale: 0.82, borderRadius: 40, rotateX: 14 }, {
        scale: 1, borderRadius: 22, rotateX: 0, ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top 90%', end: 'top 15%', scrub: true },
      })
      gsap.from('.cn-trailer-head > *', { y: 30, opacity: 0, stagger: 0.1, scrollTrigger: { trigger: root.current, start: 'top 80%' } })
    }, root)
    return () => ctx.revert()
  }, [])
  const basculer = () => {
    const v = video.current
    if (!v) return
    if (v.paused) v.play().then(() => setEnLecture(true)).catch(() => {}); else { v.pause(); setEnLecture(false) }
  }
  return (
    <section ref={root} className="cn-trailer" aria-labelledby="cn-trailer-t">
      <div className="cn-trailer-head">
        <p className="cn-chapter">— 00 — BANDE-ANNONCE</p>
        <h2 id="cn-trailer-t" className="cn-h2">32 secondes pour <span className="cn-grad">tout voir.</span></h2>
      </div>
      <div className="cn-trailer-frame">
        <video ref={video} src="/media/forgechat-trailer.mp4" poster="/media/forgechat-trailer.jpg" muted={muet} loop playsInline preload="metadata"
          aria-label="Vidéo de présentation de ForgeChat" />
        <div className="cn-trailer-ctrl">
          <button type="button" onClick={basculer} aria-label={enLecture ? 'Mettre en pause' : 'Lire la vidéo'}>{enLecture ? <Pause size={18} /> : <Play size={18} />}</button>
          <button type="button" onClick={() => setMuet(m => !m)} aria-label={muet ? 'Activer le son' : 'Couper le son'}>{muet ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        </div>
      </div>
    </section>
  )
}

function Words() {
  const root = useRef<HTMLElement>(null)
  const mots = ['Partage.', 'Discute.', 'Appelle.']
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top top', end: '+=2200', scrub: 0.6, pin: true } })
      gsap.set('.cn-word', { opacity: 0, scale: 1.25, filter: 'blur(18px)' })
      mots.forEach((_, i) => {
        tl.to(`.cn-word-${i}`, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1 })
          .to(`.cn-word-${i}`, { opacity: 0, scale: 0.85, filter: 'blur(14px)', duration: 0.7 }, '+=1.3')
      })
      tl.to('.cn-word-final', { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 1.2 })
        .from('.cn-word-final .cn-grad', { backgroundPosition: '200% 0', duration: 1 }, '<')
        .to('.cn-lines i', { scaleX: 1, opacity: 1, stagger: 0.1, duration: 0.8 }, '<')
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <section ref={root} className="cn-words" aria-label="Partage, discute, appelle : forge ta communauté">
      <div className="cn-lines" aria-hidden="true"><i /><i /><i /><i /></div>
      {mots.map((m, i) => <p key={m} className={`cn-word cn-word-${i}`} aria-hidden="true">{m}</p>)}
      <p className="cn-word cn-word-final">Forge ta<br /><span className="cn-grad">communauté.</span></p>
    </section>
  )
}

const CHAPITRES = [
  { n: '01', label: 'MESSAGERIE', a: 'Tous tes serveurs.', b: 'Dans ta poche.' },
  { n: '02', label: 'TEMPS RÉEL', a: 'Instantané.', b: 'Vraiment.' },
  { n: '03', label: 'NOTIFICATIONS', a: 'Natives.', b: 'Rien ne t’échappe.' },
]

function Chapters() {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      gsap.set('.cn-chap', { opacity: 0, y: 40 })
      gsap.set('.cn-chap-0', { opacity: 1, y: 0 })
      gsap.set('.cn-chapters .cn-pm, .cn-chapters .cn-pm-poll, .cn-chapters .cn-typing', { opacity: 0, y: 18 })
      gsap.set('.cn-chapters .cn-poll-bar', { scaleX: 0 })
      gsap.set('.cn-chapters .cn-react', { scale: 0 })
      gsap.set('.cn-chapters .cn-notif', { yPercent: -160, opacity: 0 })
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' }, scrollTrigger: { trigger: root.current, start: 'top top', end: '+=3400', scrub: 0.7, pin: true } })
      tl.from('.cn-chapters .cn-phone', { x: 120, rotate: 8, opacity: 0, duration: 1 })
        .to('.cn-chapters .cn-pm:not(.cn-pm-poll)', { opacity: 1, y: 0, stagger: 0.35, duration: 0.6 })
        .to('.cn-chap-0', { opacity: 0, y: -40, duration: 0.5 }, '+=0.3')
        .to('.cn-chap-1', { opacity: 1, y: 0, duration: 0.6 })
        .to('.cn-chapters .cn-pm-poll', { opacity: 1, y: 0, duration: 0.6 }, '<')
        .to('.cn-chapters .cn-poll-bar', { scaleX: 1, stagger: 0.15, duration: 0.8, ease: 'power2.out' })
        .to('.cn-chapters .cn-react', { scale: 1, duration: 0.4, ease: 'back.out(3)' })
        .to('.cn-chapters .cn-typing', { opacity: 1, y: 0, duration: 0.4 })
        .to('.cn-chap-1', { opacity: 0, y: -40, duration: 0.5 }, '+=0.3')
        .to('.cn-chap-2', { opacity: 1, y: 0, duration: 0.6 })
        .to('.cn-chapters .cn-notif', { yPercent: 0, opacity: 1, duration: 0.7, ease: 'back.out(1.6)' }, '<')
        .to('.cn-chapters .cn-phone', { rotate: -3, duration: 0.3, yoyo: true, repeat: 3, ease: 'sine.inOut' }, '<0.3')
        .to('.cn-chap-progress i', { scaleX: 1, ease: 'none', duration: tl.duration() }, 0)
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <section ref={root} className="cn-chapters">
      <div className="cn-chap-text">
        {CHAPITRES.map((c, i) => (
          <div key={c.n} className={`cn-chap cn-chap-${i}`}>
            <p className="cn-chapter">— {c.n} — {c.label}</p>
            <h2 className="cn-h1">{c.a}<br /><span className="cn-dim">{c.b}</span></h2>
          </div>
        ))}
        <div className="cn-chap-progress" aria-hidden="true"><i /></div>
      </div>
      <Phone />
    </section>
  )
}

const PUCES = [
  { i: <Hash size={20} />, t: 'Serveurs & salons', s: 'Texte, vocal, vidéo' },
  { i: <Mic size={20} />, t: 'Vocal & vidéo', s: 'WebRTC + anti-bruit' },
  { i: <MessageSquare size={20} />, t: 'Fils & sondages', s: 'Forums, réactions, mentions' },
  { i: <Lock size={20} />, t: 'Messages privés', s: 'DM et groupes, chiffrés' },
  { i: <Bell size={20} />, t: 'Notifs natives', s: 'Mentions en direct' },
  { i: <Server size={20} />, t: 'Self-hosted', s: 'Tes données, ton serveur' },
]

function Chips() {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top 70%', end: 'center 55%', scrub: 0.8 } })
      tl.from('.cn-chips .cn-phone', { x: -80, rotate: -10, opacity: 0, duration: 1 })
        .from('.cn-chip', { y: 50, scale: 0.85, opacity: 0, filter: 'blur(8px)', stagger: 0.18, duration: 0.8 }, '<0.2')
      // Inclinaison des puces au survol de la souris (bureau seulement).
      gsap.utils.toArray<HTMLElement>('.cn-chip').forEach(el => {
        el.addEventListener('pointermove', e => {
          const r = el.getBoundingClientRect()
          gsap.to(el, { rotateY: ((e.clientX - r.left) / r.width - 0.5) * 14, rotateX: -((e.clientY - r.top) / r.height - 0.5) * 14, duration: 0.4 })
        })
        el.addEventListener('pointerleave', () => gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.6 }))
      })
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <section ref={root} className="cn-chips" aria-labelledby="cn-chips-t">
      <Phone />
      <div>
        <p className="cn-chapter">— 04 — TOUT EST LÀ</p>
        <h2 id="cn-chips-t" className="cn-h2">Tout ce qu’il faut.<br /><span className="cn-dim">Rien de trop.</span></h2>
        <div className="cn-chip-grid">
          {PUCES.map(p => (
            <div key={p.t} className="cn-chip"><span className="cn-chip-ico">{p.i}</span><div><b>{p.t}</b><small>{p.s}</small></div></div>
          ))}
        </div>
      </div>
    </section>
  )
}

// Quelques-uns des 38 thèmes du web et du bureau (accent, halo du fond).
const THEMES = [
  { nom: 'Sombre', c: '#5865f2' }, { nom: 'Dracula', c: '#bd93f9' }, { nom: 'Gruvbox', c: '#d65d0e' },
  { nom: 'Cyberpunk', c: '#f0e14a' }, { nom: 'Monokai', c: '#a6e22e' }, { nom: 'Solarized', c: '#268bd2' },
  { nom: 'Catppuccin', c: '#cba6f7' }, { nom: 'Rose', c: '#e0245e' },
]

function Themes() {
  const root = useRef<HTMLElement>(null)
  const [i, setI] = useState(0)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      ScrollTrigger.create({
        trigger: root.current, start: 'top top', end: '+=2400', pin: true, scrub: true,
        onUpdate: s => setI(Math.min(THEMES.length - 1, Math.floor(s.progress * THEMES.length))),
      })
      gsap.from('.cn-themes .cn-side', { opacity: 0, x: (k: number) => (k ? 80 : -80), scrollTrigger: { trigger: root.current, start: 'top 75%', end: 'top 25%', scrub: true } })
    }, root)
    return () => ctx.revert()
  }, [])
  const t = THEMES[i]
  return (
    <section ref={root} className="cn-themes" style={{ '--acc': t.c } as CSSProperties} aria-labelledby="cn-themes-t">
      <div className="cn-themes-glow" aria-hidden="true" />
      <h2 id="cn-themes-t" className="cn-side cn-h1">38 thèmes.</h2>
      <div className="cn-themes-mid">
        <Phone className="cn-phone-themed" />
        <div className="cn-dots" role="tablist" aria-label="Thèmes">
          {THEMES.map((th, k) => (
            <button key={th.nom} type="button" role="tab" aria-selected={k === i} aria-label={th.nom} className={k === i ? 'is-on' : ''} style={{ background: th.c }} onClick={() => setI(k)} />
          ))}
        </div>
        <p className="cn-theme-name">{t.nom}</p>
      </div>
      <p className="cn-side cn-h1 cn-dim">Ton style.</p>
    </section>
  )
}

const CAPOT = [
  { mot: 'Rust', sous: 'BACKEND AXUM + TOKIO · ULTRA LÉGER' },
  { mot: 'Temps réel', sous: 'WEBSOCKET · LIVEKIT SFU · TURN' },
  { mot: 'Sécurisé', sous: 'JWT · RATE LIMITING · CORS STRICT · 2FA' },
  { mot: 'Partout', sous: 'WEB · WINDOWS · MACOS · LINUX · ANDROID · IPHONE' },
]

function UnderTheHood() {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      gsap.set('.cn-capot-item', { opacity: 0 })
      const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top top', end: '+=3200', scrub: 0.6, pin: true } })
      CAPOT.forEach((_, i) => {
        tl.set(`.cn-capot-item-${i}`, { opacity: 1 })
          .fromTo(`.cn-capot-item-${i} .cn-capot-mot`, { filter: 'blur(22px)', scale: 1.15, opacity: 0 }, { filter: 'blur(0px)', scale: 1, opacity: 1, duration: 0.8 })
          .fromTo(`.cn-capot-item-${i} .cn-capot-sous`, { opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.25em', duration: 0.6 }, '<0.4')
          .to('.cn-capot-count', { textContent: `0${i + 1}/04`, duration: 0.01 }, '<')
          .to('.cn-capot-bar i', { scaleX: (i + 1) / CAPOT.length, duration: 0.6 }, '<')
        if (i < CAPOT.length - 1) tl.to(`.cn-capot-item-${i}`, { opacity: 0, filter: 'blur(20px)', duration: 0.5 }, '+=1.5')
      })
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <section ref={root} className="cn-capot" aria-label="Sous le capot">
      <p className="cn-capot-label">SOUS LE CAPOT · <span className="cn-capot-count">01/04</span></p>
      {CAPOT.map((c, i) => (
        <div key={c.mot} className={`cn-capot-item cn-capot-item-${i}`}>
          <p className="cn-capot-mot">{c.mot}<span className="cn-dot">.</span></p>
          <p className="cn-capot-sous">{c.sous}</p>
        </div>
      ))}
      <div className="cn-capot-bar" aria-hidden="true"><i /></div>
    </section>
  )
}

function Finale() {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top 65%' } })
      tl.from('.cn-finale .cn-logo', { scale: 0, rotate: 20, duration: 0.9, ease: 'back.out(1.8)' })
        .from('.cn-finale .cn-ch', { opacity: 0, x: -8, stagger: 0.07, duration: 0.05 }, '-=0.2')
        .from('.cn-finale .cn-pill, .cn-finale .cn-actions, .cn-finale .cn-devices a, .cn-finale .cn-url', { y: 20, opacity: 0, stagger: 0.12, duration: 0.6, ease: 'power3.out' })
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <section ref={root} className="cn-finale">
      <Dust density={45} />
      <div className="cn-finale-brand">
        <LogoMark size={88} />
        <p className="cn-finale-title" aria-label="ForgeChat">
          <span aria-hidden="true">{[...'Forge'].map((c, i) => <span key={i} className="cn-ch">{c}</span>)}</span>
          <span aria-hidden="true" className="cn-grad">{[...'Chat'].map((c, i) => <span key={i} className="cn-ch">{c}</span>)}</span>
        </p>
      </div>
      <p className="cn-pill"><i /> Disponible maintenant, partout</p>
      <div className="cn-actions">
        <Link to="/telecharger" className="site-btn site-btn-primary"><Download size={18} /> Télécharger ForgeChat</Link>
        <Link to="/register" className="site-btn site-btn-ghost">Créer un compte</Link>
      </div>
      <nav className="cn-devices" aria-label="Télécharger par appareil">
        {[['windows', 'Windows'], ['macos', 'macOS'], ['linux', 'Linux'], ['android', 'Android'], ['iphone', 'iPhone'], ['web', 'Navigateur']].map(([id, nom]) => (
          <Link key={id} to={`/telecharger/${id}`}>{nom}</Link>
        ))}
      </nav>
      <p className="cn-url">forgechat.heiphaistos.org</p>
    </section>
  )
}

export default function Cinema() {
  // Les pages chargées à la demande décalent la mise en page : recalculer les déclencheurs ensuite.
  useEffect(() => {
    const t = setTimeout(() => ScrollTrigger.refresh(), 400)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="cn">
      <Hero />
      <Trailer />
      <Words />
      <Chapters />
      <Chips />
      <Themes />
      <UnderTheHood />
      <Finale />
    </div>
  )
}
