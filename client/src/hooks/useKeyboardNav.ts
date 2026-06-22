import { useState, useCallback, useEffect } from 'react'

export function useKeyboardNav<T>(
  items: T[],
  onSelect: (item: T) => void,
  isOpen: boolean,
): {
  activeIndex: number
  setActiveIndex: (i: number) => void
  handleKey: (e: KeyboardEvent) => void
} {
  const [activeIndex, setActiveIndex] = useState(-1)

  // Reset quand la liste change ou fermeture
  useEffect(() => {
    setActiveIndex(-1)
  }, [items.length, isOpen])

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen || items.length === 0) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex(i => (i + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex(i => (i <= 0 ? items.length - 1 : i - 1))
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && activeIndex < items.length) {
          e.preventDefault()
          onSelect(items[activeIndex])
        }
      } else if (e.key === 'Escape') {
        setActiveIndex(-1)
      }
    },
    [isOpen, items, activeIndex, onSelect],
  )

  return { activeIndex, setActiveIndex, handleKey }
}
