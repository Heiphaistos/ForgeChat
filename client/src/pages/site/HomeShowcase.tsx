import { useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import './showcase.css'
import { Bell, Hash, Headphones, Mic, MonitorUp, PhoneOff, Plus, Settings, Smile, Video, Volume2 } from 'lucide-react'

gsap.registerPlugin(ScrollTrigger)

const reduit = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ─────────────────────────── Titre cinétique ─────────────────────────── */

/** Titre découpé en lettres qui montent une à une (le texte reste lisible pour les lecteurs d'écran). */
export function KineticTitle({ lignes }: { lignes: { texte: string; grad?: boolean }[] }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      gsap.from('.kt-char', {
        yPercent: 110, rotate: 8, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.025, delay: 0.15,
      })
    }, ref)
    return () => ctx.revert()
  }, [])
  return (
    <h1 ref={ref} className="site-h1 kt" aria-label={lignes.map(l => l.texte).join(' ')}>
      {lignes.map((l, i) => (
        <span key={i} className="kt-line" aria-hidden="true">
          {/* Un dégradé découpé dans le texte ne survit pas à une transformation par lettre :
              la ligne en dégradé s'anime d'un bloc. */}
          {l.grad
            ? <span className="kt-char grad">{l.texte}</span>
            : [...l.texte].map((c, j) => <span key={j} className="kt-char">{c === ' ' ? ' ' : c}</span>)}
        </span>
      ))}
    </h1>
  )
}

/* ─────────────────────────── Projecteur souris ─────────────────────────── */

/** Halo qui suit la souris sur le héros (variable CSS, aucune boucle d'animation permanente). */
export function useSpotlight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || reduit()) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    el.addEventListener('pointermove', move)
    return () => el.removeEventListener('pointermove', move)
  }, [])
  return ref
}

/* ─────────────────────────── Démo de l'application ─────────────────────────── */

const MESSAGES = [
  { qui: 'Lina', c: '#f2994a', txt: 'La nouvelle maquette est prête 🎨' },
  { qui: 'Théo', c: '#3ddc97', txt: 'Trop bien ! On en parle en vocal ?' },
  { qui: 'Sam', c: '#a78bfa', txt: 'Go, je vous rejoins depuis mon téléphone 📱' },
]
const SCENES = [
  { titre: 'Écrivez', texte: 'Salons, fils, réactions, mentions : la conversation coule, en temps réel.' },
  { titre: 'Parlez', texte: 'Un clic sur un salon vocal et tout le monde s’entend, du PC au téléphone.' },
  { titre: 'Partagez', texte: 'Écran, caméra, fichiers : montrez votre travail en direct, jusqu’en 1080p.' },
  { titre: 'Partout', texte: 'Fermez l’ordinateur, la discussion continue sur votre téléphone. Même compte, même instant.' },
]

function Avatar({ nom, c, parle }: { nom: string; c: string; parle?: boolean }) {
  return <span className={`sd-av ${parle ? 'sd-speaking' : ''}`} style={{ background: c }}>{nom[0]}</span>
}

/**
 * Démo épinglée : le défilement fait avancer une timeline GSAP (scrub) qui joue les 4 scènes
 * dans une fausse fenêtre ForgeChat, puis fait glisser un téléphone synchronisé.
 */
export function AppShowcase() {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const ctx = gsap.context(() => {
      gsap.set('.sd-msg, .sd-voice-user, .sd-share, .sd-phone, .sd-toast', { autoAlpha: 0 })
      gsap.set('.sd-caption', { autoAlpha: 0, y: 30 })
      gsap.set('.sd-caption-0', { autoAlpha: 1, y: 0 })
      const tl = gsap.timeline({
        defaults: { ease: 'power3.out', duration: 1 },
        scrollTrigger: { trigger: root.current, start: 'top top', end: '+=3200', scrub: 0.8, pin: '.sd-stage', anticipatePin: 1 },
      })
      const caption = (i: number) => {
        tl.to(`.sd-caption-${i - 1}`, { autoAlpha: 0, y: -30, duration: 0.5 })
          .to(`.sd-caption-${i}`, { autoAlpha: 1, y: 0, duration: 0.6 }, '<0.2')
          .to('.sd-progress i', { width: `${(i + 1) * 25}%`, duration: 0.6 }, '<')
      }
      // Scène 1 : les messages arrivent.
      tl.from('.sd-window', { scale: 0.9, rotateX: 18, y: 60, duration: 1.2 })
        .to('.sd-msg', { autoAlpha: 1, y: 0, stagger: 0.6, startAt: { y: 24 } })
        .to('.sd-typing', { autoAlpha: 0, duration: 0.3 })
      // Scène 2 : le salon vocal s'anime.
      caption(1)
      tl.to('.sd-chan-voice', { backgroundColor: 'rgba(88,101,242,.25)', duration: 0.4 })
        .to('.sd-voice-user', { autoAlpha: 1, x: 0, startAt: { x: -16 }, stagger: 0.35 })
        .to('.sd-voicebar', { y: 0, autoAlpha: 1, startAt: { y: 40, autoAlpha: 0 } }, '<')
      // Scène 3 : partage d'écran.
      caption(2)
      tl.to('.sd-share', { autoAlpha: 1, scale: 1, startAt: { scale: 0.6 }, duration: 1.1, ease: 'back.out(1.4)' })
        .from('.sd-share-line', { scaleX: 0, transformOrigin: 'left', stagger: 0.15, duration: 0.5 }, '<0.4')
      // Scène 4 : le téléphone prend le relais.
      caption(3)
      tl.to('.sd-window', { x: '-4%', scale: 0.82, rotateY: 10, duration: 1.2 })
        .to('.sd-phone', { autoAlpha: 1, x: 0, rotate: 0, startAt: { x: 200, rotate: 12 }, duration: 1.2 }, '<')
        .to('.sd-toast', { autoAlpha: 1, y: 0, startAt: { y: -30 }, duration: 0.6, ease: 'back.out(2)' })
        .to({}, { duration: 0.6 })
    }, root)
    return () => ctx.revert()
  }, [])

  return (
    <section ref={root} className="sd" aria-label="Démonstration de ForgeChat">
      <div className="sd-stage">
        <div className="sd-captions">
          <p className="site-eyebrow">La démo</p>
          {SCENES.map((s, i) => (
            <div key={s.titre} className={`sd-caption sd-caption-${i}`}>
              <h2 className="site-h2">{s.titre}<span className="grad">.</span></h2>
              <p className="site-lead">{s.texte}</p>
            </div>
          ))}
          <div className="sd-progress" aria-hidden="true"><i /></div>
        </div>

        <div className="sd-scene" aria-hidden="true">
          <div className="sd-window">
            <div className="sd-rail">
              <span className="sd-srv is-on">F</span><span className="sd-srv">D</span><span className="sd-srv">J</span>
              <span className="sd-srv sd-add"><Plus size={16} /></span>
            </div>
            <div className="sd-chans">
              <p className="sd-srvname">La Forge</p>
              <p className="sd-cat">Salons textuels</p>
              <p className="sd-chan"><Hash size={14} /> général</p>
              <p className="sd-chan is-on"><Hash size={14} /> design</p>
              <p className="sd-cat">Salons vocaux</p>
              <p className="sd-chan sd-chan-voice"><Volume2 size={14} /> Atelier</p>
              {[['Lina', '#f2994a', true], ['Théo', '#3ddc97', false], ['Sam', '#a78bfa', true]].map(([n, c, p]) => (
                <p key={n as string} className="sd-voice-user"><Avatar nom={n as string} c={c as string} parle={p as boolean} /> {n as string}</p>
              ))}
              <div className="sd-voicebar">
                <span className="sd-live">● Connecté</span>
                <span><Mic size={14} /><Headphones size={14} /><MonitorUp size={14} /><PhoneOff size={14} /></span>
              </div>
            </div>
            <div className="sd-main">
              <div className="sd-top"><Hash size={16} /> design <span className="sd-top-ico"><Bell size={15} /><Video size={15} /><Settings size={15} /></span></div>
              <div className="sd-msgs">
                {MESSAGES.map(m => (
                  <div key={m.qui} className="sd-msg">
                    <Avatar nom={m.qui} c={m.c} />
                    <div><b style={{ color: m.c }}>{m.qui}</b> <small>aujourd’hui</small><p>{m.txt}</p></div>
                  </div>
                ))}
                <p className="sd-typing">Lina est en train d’écrire<span>.</span><span>.</span><span>.</span></p>
              </div>
              <div className="sd-share">
                <div className="sd-share-bar"><MonitorUp size={14} /> Lina partage son écran · 1080p</div>
                <div className="sd-share-body">
                  <span className="sd-share-line" style={{ width: '70%' }} />
                  <span className="sd-share-line" style={{ width: '45%' }} />
                  <span className="sd-share-line sd-share-accent" style={{ width: '60%' }} />
                  <span className="sd-share-line" style={{ width: '35%' }} />
                </div>
              </div>
              <div className="sd-input"><Plus size={16} /> Envoyer un message dans #design <Smile size={16} /></div>
            </div>
          </div>

          <div className="sd-phone">
            <div className="sd-notch" />
            <div className="sd-toast"><b>ForgeChat</b> Sam : « J’arrive dans le vocal ! »</div>
            <p className="sd-phone-title"><Hash size={13} /> design</p>
            {MESSAGES.map(m => (
              <div key={m.qui} className="sd-pmsg"><Avatar nom={m.qui} c={m.c} /><p><b style={{ color: m.c }}>{m.qui}</b><br />{m.txt}</p></div>
            ))}
            <div className="sd-pvoice"><Volume2 size={13} /> Atelier · 3 connectés</div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────── Fonctionnalités en défilement horizontal ─────────────────────────── */

export function HorizontalFeatures({ items }: { items: { icone: React.ReactNode; titre: string; texte: string }[] }) {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (reduit()) return
    const mm = gsap.matchMedia()
    mm.add('(min-width: 900px)', () => {
      const track = root.current!.querySelector<HTMLElement>('.hf-track')!
      const distance = () => track.scrollWidth - window.innerWidth + 64
      const scroll = gsap.to(track, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top top', end: () => `+=${distance()}`, scrub: 0.6, pin: true, invalidateOnRefresh: true },
      })
      gsap.utils.toArray<HTMLElement>('.hf-card').forEach(card => {
        gsap.from(card, { rotateY: -25, opacity: 0.3, scrollTrigger: { trigger: card, containerAnimation: scroll, start: 'left 95%', end: 'left 65%', scrub: true } })
      })
    })
    return () => mm.revert()
  }, [])
  return (
    <section ref={root} className="hf" aria-labelledby="hf-title">
      <div className="site-wrap"><h2 id="hf-title" className="site-h2">Tout ce qu’on attend d’une messagerie.<br /><span className="grad">Et bien plus.</span></h2></div>
      <div className="hf-track">
        {items.map(f => (
          <article key={f.titre} className="site-card hf-card">
            <div className="ico">{f.icone}</div>
            <h3 className="site-h3">{f.titre}</h3>
            <p className="site-muted" style={{ margin: 0 }}>{f.texte}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
