// Vidéo du vocal natif Linux : images JPEG poussées par le serveur local
// (`ws://127.0.0.1:PORT/w/CLE?k=SECRET`) et dessinées dans un <canvas>.
//
// Pas de flux MJPEG dans un <img> : mesuré le 2026-09-23, ce chemin fait
// planter le processus web de WebKitGTK 2.50.4 dans l'application.
import { useEffect, useRef } from 'react'

export default function NativeVideo({ url, fit = 'cover', className = '', style }: {
  url: string
  fit?: 'cover' | 'contain'
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    let closed = false
    let busy = false
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    const onFrame = async (e: MessageEvent<Blob>) => {
      // Une image à la fois : si le décodage prend du retard, on saute les suivantes.
      if (busy || closed) return
      busy = true
      try {
        const bmp = await createImageBitmap(e.data)
        const W = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
        const H = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
        const r = fit === 'cover' ? Math.max(W / bmp.width, H / bmp.height) : Math.min(W / bmp.width, H / bmp.height)
        const dw = bmp.width * r
        const dh = bmp.height * r
        g.fillStyle = '#000'
        g.fillRect(0, 0, W, H)
        g.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh)
        bmp.close()
        canvas.dataset.frames = String(Number(canvas.dataset.frames ?? '0') + 1)
      } catch { /* image corrompue : on attend la suivante */ } finally {
        busy = false
      }
    }
    // Reconnexion tant que la tuile est affichée : le canal se ferme quand le flux
    // s'interrompt (changement de résolution, reprise réseau du SFU).
    const open = () => {
      if (closed) return
      ws = new WebSocket(url)
      ws.binaryType = 'blob'
      ws.onmessage = onFrame
      ws.onclose = () => { if (!closed) retry = setTimeout(open, 1000) }
    }
    open()
    return () => { closed = true; if (retry) clearTimeout(retry); ws?.close() }
  }, [url, fit])

  return <canvas ref={ref} data-native-video className={`block ${className}`} style={style} />
}
