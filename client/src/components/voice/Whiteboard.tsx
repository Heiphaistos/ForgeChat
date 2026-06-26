import { useRef, useEffect, useState, useCallback } from 'react'
import { useWs } from '../../store/ws'
import { Pencil, Eraser, Trash2, Download, Square, Circle as CircleIcon, Minus } from 'lucide-react'

type Tool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle'

interface DrawEvent {
  type: 'WHITEBOARD_DRAW'
  channel_id: string
  tool: Tool
  color: string
  size: number
  points: { x: number; y: number }[]
}

interface Props { channelId: string; onClose: () => void }

export default function Whiteboard({ channelId, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { send, on } = useWs()
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#ffffff')
  const [size, setSize] = useState(3)
  const [drawing, setDrawing] = useState(false)
  const pointsRef = useRef<{ x: number; y: number }[]>([])

  const getCtx = () => canvasRef.current?.getContext('2d')

  const drawPoints = useCallback((ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], t: Tool, c: string, s: number) => {
    ctx.strokeStyle = t === 'eraser' ? '#1e1f29' : c
    ctx.lineWidth = t === 'eraser' ? s * 4 : s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (t === 'pen' || t === 'eraser') {
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.stroke()
    }
  }, [])

  useEffect(() => {
    const off = on('WHITEBOARD_DRAW', (d: unknown) => {
      const data = d as DrawEvent
      if (data.channel_id !== channelId) return
      const ctx = getCtx()
      if (ctx) drawPoints(ctx, data.points, data.tool, data.color, data.size)
    })
    const offClear = on('WHITEBOARD_CLEAR', (d: unknown) => {
      const data = d as { channel_id: string }
      if (data.channel_id !== channelId) return
      const ctx = getCtx()
      if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    })
    return () => { off(); offClear() }
  }, [channelId, drawPoints, on])

  const getPos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvasRef.current!.width / rect.width),
      y: (e.clientY - rect.top) * (canvasRef.current!.height / rect.height),
    }
  }

  const onMouseDown = (e: React.MouseEvent) => { setDrawing(true); pointsRef.current = [getPos(e)] }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const pt = getPos(e)
    pointsRef.current.push(pt)
    const ctx = getCtx()
    if (ctx) drawPoints(ctx, pointsRef.current.slice(-2), tool, color, size)
  }
  const onMouseUp = () => {
    if (!drawing) return
    setDrawing(false)
    send({ type: 'WHITEBOARD_DRAW', channel_id: channelId, tool, color, size, points: pointsRef.current })
    pointsRef.current = []
  }

  const clear = () => {
    const ctx = getCtx()
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    send({ type: 'WHITEBOARD_CLEAR', channel_id: channelId })
  }

  const download = () => {
    const a = document.createElement('a')
    a.href = canvasRef.current?.toDataURL('image/png') ?? ''
    a.download = `whiteboard-${channelId}-${Date.now()}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 bg-fc-sidebar border-b border-fc-hover">
        <span className="text-white font-semibold text-sm">Tableau blanc</span>
        <div className="flex items-center gap-1 flex-1">
          {([
            ['pen', <Pencil size={14} />],
            ['eraser', <Eraser size={14} />],
            ['line', <Minus size={14} />],
            ['rect', <Square size={14} />],
            ['circle', <CircleIcon size={14} />],
          ] as [Tool, React.ReactNode][]).map(([t, icon]) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`p-1.5 rounded ${tool === t ? 'bg-fc-accent text-white' : 'text-fc-muted hover:bg-fc-hover'}`}
            >
              {icon}
            </button>
          ))}
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent"
          />
          <input
            type="range"
            min={1}
            max={20}
            value={size}
            onChange={e => setSize(+e.target.value)}
            className="w-20"
          />
          <button onClick={clear} className="p-1.5 text-fc-red hover:bg-fc-red/10 rounded">
            <Trash2 size={14} />
          </button>
          <button onClick={download} className="p-1.5 text-fc-muted hover:bg-fc-hover rounded">
            <Download size={14} />
          </button>
        </div>
        <button onClick={onClose} className="text-fc-muted hover:text-white text-sm px-2 py-1 hover:bg-fc-hover rounded">
          Fermer
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={1920}
        height={1080}
        className="flex-1 w-full cursor-crosshair"
        style={{ background: '#1e1f29' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  )
}
