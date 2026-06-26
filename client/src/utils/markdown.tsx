import hljs from 'highlight.js'

function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value } catch {}
  }
  try { return hljs.highlightAuto(code).value } catch {}
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Parser Markdown minimaliste compatible Discord
export function renderMarkdown(text: string, customEmojis?: Record<string, string>): React.ReactNode {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Bloc de code ```
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <div key={i} className="bg-[#1e1f29] rounded-lg mt-1 mb-1 overflow-hidden border border-white/5">
          {lang && (
            <div className="flex items-center justify-between px-3 py-1 bg-black/30 border-b border-white/5">
              <span className="text-xs text-fc-muted font-mono">{lang}</span>
            </div>
          )}
          <pre className="p-3 overflow-x-auto text-sm font-mono whitespace-pre leading-relaxed hljs">
            <code dangerouslySetInnerHTML={{ __html: highlightCode(codeLines.join('\n'), lang) }} />
          </pre>
        </div>
      )
      i++
      continue
    }

    // Citation >
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={i} className="border-l-4 border-fc-accent bg-fc-input/50 pl-3 py-0.5 rounded-r my-0.5 text-fc-muted italic">
          {inlineMarkdown(line.slice(2))}
        </blockquote>
      )
      i++
      continue
    }

    // Ligne vide
    if (line.trim() === '') {
      elements.push(<br key={i} />)
      i++
      continue
    }

    // Ligne normale avec inline markdown
    elements.push(<span key={i} style={{ display: 'block' }}>{inlineMarkdown(line, customEmojis)}</span>)
    i++
  }

  return <div className="fc-markdown">{elements}</div>
}

function inlineMarkdown(text: string, customEmojis?: Record<string, string>): React.ReactNode {
  const parts = tokenize(text, customEmojis)
  return <>{parts}</>
}

// Timestamp Discord-style : <t:1234567890:R> → "il y a 2 heures"
function formatRelativeTime(unix: number): string {
  const now = Date.now()
  const diff = now - unix * 1000
  const abs = Math.abs(diff)
  const future = diff < 0

  const seconds = Math.floor(abs / 1000)
  const minutes = Math.floor(abs / 60000)
  const hours = Math.floor(abs / 3600000)
  const days = Math.floor(abs / 86400000)

  let label: string
  if (seconds < 60) label = 'à l\'instant'
  else if (minutes < 60) label = `${minutes} minute${minutes > 1 ? 's' : ''}`
  else if (hours < 24) label = `${hours} heure${hours > 1 ? 's' : ''}`
  else label = `${days} jour${days > 1 ? 's' : ''}`

  if (seconds < 60) return label
  return future ? `dans ${label}` : `il y a ${label}`
}

function tokenize(text: string, customEmojis?: Record<string, string>): React.ReactNode[] {
  const pattern = /(`[^`]+`|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|~~(.+?)~~|\|\|(.+?)\|\||<@[^>]+>|<t:\d+:[RrDdFftT]>|@everyone|@here|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|https?:\/\/\S+|:[a-z0-9_]+:)/g
  const result: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    // Texte avant
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index))
    }

    const full = match[0]

    if (full.startsWith('`') && full.endsWith('`')) {
      result.push(<code key={match.index}>{full.slice(1, -1)}</code>)
    } else if (full.startsWith('***') && full.endsWith('***')) {
      result.push(<strong key={match.index}><em>{full.slice(3, -3)}</em></strong>)
    } else if (full.startsWith('**') && full.endsWith('**')) {
      result.push(<strong key={match.index}>{full.slice(2, -2)}</strong>)
    } else if ((full.startsWith('*') && full.endsWith('*')) || (full.startsWith('_') && full.endsWith('_'))) {
      result.push(<em key={match.index}>{full.slice(1, -1)}</em>)
    } else if (full.startsWith('__') && full.endsWith('__')) {
      result.push(<u key={match.index}>{full.slice(2, -2)}</u>)
    } else if (full.startsWith('~~') && full.endsWith('~~')) {
      result.push(<del key={match.index}>{full.slice(2, -2)}</del>)
    } else if (full.startsWith('||') && full.endsWith('||')) {
      result.push(
        <SpoilerText key={match.index} text={full.slice(2, -2)} />
      )
    } else if (full === '@everyone' || full === '@here') {
      result.push(
        <span key={match.index} className="mention mention-everyone">{full}</span>
      )
    } else if (full.startsWith('<@')) {
      result.push(<span key={match.index} className="mention">{full}</span>)
    } else if (full.startsWith('<t:')) {
      // Timestamp Discord-style <t:1234567890:R>
      const tsMatch = full.match(/^<t:(\d+):([RrDdFftT])>$/)
      if (tsMatch) {
        const unix = parseInt(tsMatch[1], 10)
        const fmt = tsMatch[2]
        let display: string
        if (fmt === 'R' || fmt === 'r') {
          display = formatRelativeTime(unix)
        } else {
          display = new Date(unix * 1000).toLocaleString('fr-FR', {
            dateStyle: fmt === 'd' || fmt === 'D' ? 'short' : undefined,
            timeStyle: fmt === 't' || fmt === 'T' ? 'short' : undefined,
          })
        }
        result.push(
          <span key={match.index} className="bg-fc-hover/60 rounded px-1 text-fc-accent font-medium text-xs" title={new Date(unix * 1000).toLocaleString('fr-FR')}>
            {display}
          </span>
        )
      } else {
        result.push(full)
      }
    } else if (full.startsWith('[')) {
      // Lien Markdown [texte](url)
      const linkMatch = full.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
      if (linkMatch) {
        result.push(
          <a key={match.index} href={linkMatch[2]} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>
        )
      } else {
        result.push(full)
      }
    } else if (full.startsWith('http')) {
      result.push(
        <a key={match.index} href={full} target="_blank" rel="noopener noreferrer">
          {full}
        </a>
      )
    } else if (full.startsWith(':') && full.endsWith(':') && customEmojis) {
      const name = full.slice(1, -1)
      const url = customEmojis[name]
      if (url) {
        result.push(
          <img key={match.index} src={url} alt={name} title={`:${name}:`}
            className="inline-block w-5 h-5 object-contain align-middle mx-0.5" />
        )
      } else {
        result.push(full)
      }
    } else {
      result.push(full)
    }

    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }

  return result
}

import { useState } from 'react'

function SpoilerText({ text }: { text: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      onClick={() => setRevealed(true)}
      className={`rounded px-0.5 cursor-pointer transition-colors ${
        revealed ? 'bg-transparent' : 'bg-fc-muted/40 text-transparent select-none hover:bg-fc-muted/60'
      }`}
    >
      {text}
    </span>
  )
}
