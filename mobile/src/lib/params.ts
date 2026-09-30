import { useLocalSearchParams } from 'expo-router'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/**
 * Lecture typée et VALIDÉE des paramètres de route. Les routes sont
 * atteignables par lien profond (forgechat://…, liens universels, push) :
 * tout paramètre est une entrée non fiable.
 */
export function useRouteParams<K extends string>(uuidKeys: readonly K[], textKeys: readonly string[] = []) {
  const raw = useLocalSearchParams<Record<string, string | string[]>>()
  const pick = (k: string) => {
    const v = raw[k]
    return Array.isArray(v) ? v[0] : v
  }
  const ids = {} as Record<K, string>
  let valid = true
  for (const k of uuidKeys) {
    const v = pick(k)
    if (isUuid(v)) ids[k] = v.toLowerCase()
    else valid = false
  }
  const text: Record<string, string | undefined> = {}
  for (const k of textKeys) {
    const v = pick(k)
    text[k] = typeof v === 'string' ? v.slice(0, 100) : undefined
  }
  return { valid, ids, text }
}
