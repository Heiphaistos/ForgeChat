// Carte générée SUR L'APPAREIL (canvas, aucun service) : bienvenue et niveau.
import { useEffect, useRef } from 'react'
import { Download } from 'lucide-react'
import { mediaUrl } from '../../api/client'
import { useT } from '../../i18n'

export interface CardData {
  title: string
  subtitle?: string
  footer?: string
  avatar?: string | null
  name: string
  /** Barre d'avancement (carte de niveau), entre 0 et 1. */
  progress?: number
  accent?: string
}

const W = 800
const H = 260

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s}…`
}

async function draw(canvas: HTMLCanvasElement, d: CardData) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const accent = d.accent ?? '#5865F2'
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#1e1f29')
  bg.addColorStop(1, accent)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.beginPath()
  ctx.arc(W - 60, 30, 160, 0, Math.PI * 2)
  ctx.fill()

  // Avatar rond (initiale si l'image manque ou refuse le canvas).
  const cx = 130, cy = H / 2, r = 80
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()
  const img = d.avatar ? await loadImage(mediaUrl(d.avatar) ?? d.avatar) : null
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2)
  else {
    ctx.fillStyle = '#2b2d31'
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 72px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((d.name[0] ?? '?').toUpperCase(), cx, cy + 4)
  }
  ctx.restore()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  const x = 250, max = W - x - 40
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px sans-serif'
  ctx.fillText(fitText(ctx, d.title, max), x, 100)
  if (d.subtitle) {
    ctx.font = '24px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.fillText(fitText(ctx, d.subtitle, max), x, 145)
  }
  if (d.progress !== undefined) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(x, 170, max, 22)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, 170, Math.round(max * d.progress), 22)
  }
  if (d.footer) {
    ctx.font = '22px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.fillText(fitText(ctx, d.footer, max), x, 225)
  }
}

export default function GeneratedCard({ data, filename }: { data: CardData; filename?: string }) {
  const t = useT()
  const ref = useRef<HTMLCanvasElement>(null)
  const key = JSON.stringify(data)
  useEffect(() => {
    if (ref.current) void draw(ref.current, data)
  }, [key])

  const save = () => {
    try {
      ref.current?.toBlob(b => {
        if (!b) return
        const url = URL.createObjectURL(b)
        const a = document.createElement('a')
        a.href = url
        a.download = filename ?? 'carte.png'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }, 'image/png')
    } catch {
      /* image d'un autre domaine : canvas non exportable, la carte reste affichée */
    }
  }

  return (
    <div className="relative group mt-1 max-w-[480px]">
      <canvas ref={ref} width={W} height={H} role="img" aria-label={`${data.title}${data.subtitle ? ` — ${data.subtitle}` : ''}`}
        className="w-full h-auto rounded-xl shadow-lg" />
      {filename && (
        <button onClick={save} title={t('community.card.save')} aria-label={t('community.card.save')}
          className="absolute top-2 right-2 p-1.5 rounded bg-black/40 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition">
          <Download size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}
