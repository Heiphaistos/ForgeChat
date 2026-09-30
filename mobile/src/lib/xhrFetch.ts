/**
 * `fetch` minimal au-dessus de XMLHttpRequest, réservé aux envois multipart.
 *
 * Depuis le SDK 57, le `fetch` global est celui d'Expo (expo/fetch), qui refuse les parties
 * React Native `{ uri, name, type }` du FormData (« Unsupported FormDataPart implementation »).
 * Le XMLHttpRequest de React Native, lui, les envoie en flux depuis le natif, sans charger
 * le fichier en mémoire JS.
 */
export function xhrFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body: FormData; signal?: AbortSignal },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const onAbort = () => xhr.abort()
    const cleanup = () => init.signal?.removeEventListener('abort', onAbort)

    if (init.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    xhr.open(init.method, url)
    // Équivalent de `credentials: 'omit'` (lib/http) : RN envoie les cookies par défaut en XHR.
    xhr.withCredentials = false
    for (const [k, v] of Object.entries(init.headers)) xhr.setRequestHeader(k, v)
    xhr.onload = () => {
      cleanup()
      const status = xhr.status
      const headers = new Headers()
      for (const line of xhr.getAllResponseHeaders().trim().split(/\r?\n/)) {
        const i = line.indexOf(':')
        if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim())
      }
      // Un corps est interdit pour 204/205/304 par le constructeur Response.
      const body = status === 204 || status === 205 || status === 304 ? null : xhr.responseText
      resolve(new Response(body, { status, headers }))
    }
    xhr.onerror = () => {
      cleanup()
      reject(new TypeError('Network request failed'))
    }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => {
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    init.signal?.addEventListener('abort', onAbort)
    xhr.send(init.body)
  })
}
