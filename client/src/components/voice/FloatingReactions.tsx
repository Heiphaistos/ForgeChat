import { useState, useEffect, useRef } from 'react'
import { useWs } from '../../store/ws'

interface FloatingEmoji { id: string; emoji: string; x: number }

export default function FloatingReactions({ channelId }: { channelId: string }) {
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([])
  const { on } = useWs()
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const off = on('VOICE_REACTION', (data: unknown) => {
      const d = data as { channel_id: string; emoji: string }
      if (d.channel_id !== channelId) return
      const id = Math.random().toString(36).slice(2)
      const x = 10 + Math.random() * 80
      setEmojis(prev => [...prev, { id, emoji: d.emoji, x }])
      const t = setTimeout(() => setEmojis(prev => prev.filter(e => e.id !== id)), 3000)
      timers.current.push(t)
    })
    return () => { off(); timers.current.forEach(clearTimeout); timers.current = [] }
  }, [channelId, on])

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {emojis.map(e => (
        <div
          key={e.id}
          className="absolute bottom-20 text-3xl select-none"
          style={{ left: `${e.x}%`, animation: 'floatUp 3s ease-out forwards' }}
        >
          {e.emoji}
        </div>
      ))}
      <style>{`@keyframes floatUp { from { opacity:1; transform:translateY(0) } to { opacity:0; transform:translateY(-300px) } }`}</style>
    </div>
  )
}
