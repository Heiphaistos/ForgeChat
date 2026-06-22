import { useEffect, useRef } from 'react'

/**
 * Retourne un ref à attacher à un élément sentinel.
 * Le callback est appelé quand l'élément entre dans le viewport.
 */
export function useIntersection<T extends HTMLElement>(
  callback: () => void,
  options?: IntersectionObserverInit,
) {
  const ref = useRef<T>(null)
  const cbRef = useRef(callback)
  cbRef.current = callback

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) cbRef.current() },
      { threshold: 0.1, ...options },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}
