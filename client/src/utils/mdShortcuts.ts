// Raccourcis markdown pour les textareas légers (threads, forums) :
// Ctrl+B gras, Ctrl+I italique, Ctrl+U souligné, Ctrl+Shift+X barré.
// Retourne true si le raccourci a été traité (l'appelant peut alors return).
export function handleMarkdownShortcut(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  setValue: (v: string) => void,
): boolean {
  if (!e.ctrlKey || e.altKey) return false
  const k = e.key.toLowerCase()
  let marker: string | null = null
  if (!e.shiftKey && k === 'b') marker = '**'
  else if (!e.shiftKey && k === 'i') marker = '*'
  else if (!e.shiftKey && k === 'u') marker = '__'
  else if (e.shiftKey && k === 'x') marker = '~~'
  if (!marker) return false
  e.preventDefault()
  const ta = e.currentTarget
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const selected = value.slice(start, end)
  const inner = selected || 'texte'
  setValue(value.slice(0, start) + marker + inner + marker + value.slice(end))
  const newStart = start + marker.length
  setTimeout(() => {
    ta.focus()
    ta.setSelectionRange(newStart, newStart + inner.length)
  }, 0)
  return true
}
