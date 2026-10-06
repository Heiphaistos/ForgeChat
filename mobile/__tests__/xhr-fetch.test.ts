import { xhrFetch } from '@/lib/xhrFetch'

/** Faux XMLHttpRequest : enregistre la requête, la test pilote la réponse. */
class FakeXhr {
  static last: FakeXhr
  method = ''
  url = ''
  withCredentials = true
  headers: Record<string, string> = {}
  body: unknown
  status = 0
  responseText = ''
  responseHeaders = ''
  aborted = false
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v
  }
  getAllResponseHeaders() {
    return this.responseHeaders
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  respond(status: number, text: string, headers = '') {
    this.status = status
    this.responseText = text
    this.responseHeaders = headers
    this.onload?.()
  }
}

const realXhr = global.XMLHttpRequest
beforeAll(() => {
  global.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
})
afterAll(() => {
  global.XMLHttpRequest = realXhr
})

const form = () => new FormData()

describe('xhrFetch (uploads multipart)', () => {
  it('envoie méthode, en-têtes et FormData, sans cookies', async () => {
    const body = form()
    const p = xhrFetch('https://api.example/up', { method: 'POST', headers: { Authorization: 'Bearer x' }, body })
    const x = FakeXhr.last
    expect([x.method, x.url, x.headers.Authorization, x.body, x.withCredentials]).toEqual(['POST', 'https://api.example/up', 'Bearer x', body, false])
    x.respond(200, '[{"id":"a"}]', 'Content-Type: application/json\r\nX-Test: 1')
    const res = await p
    expect(res.status).toBe(200)
    expect(res.headers.get('x-test')).toBe('1')
    expect(await res.json()).toEqual([{ id: 'a' }])
  })

  it('transmet les erreurs HTTP comme réponse (pas comme exception)', async () => {
    const p = xhrFetch('u', { method: 'POST', headers: {}, body: form() })
    FakeXhr.last.respond(400, '{"error":"Extension .exe non autorisée"}')
    const res = await p
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Extension .exe non autorisée' })
  })

  it('accepte 204 sans corps', async () => {
    const p = xhrFetch('u', { method: 'POST', headers: {}, body: form() })
    FakeXhr.last.respond(204, '')
    expect((await p).status).toBe(204)
  })

  it('rejette en erreur réseau', async () => {
    const p = xhrFetch('u', { method: 'POST', headers: {}, body: form() })
    FakeXhr.last.onerror?.()
    await expect(p).rejects.toThrow('Network request failed')
  })

  it('annule via le signal', async () => {
    const ctrl = new AbortController()
    const p = xhrFetch('u', { method: 'POST', headers: {}, body: form(), signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeXhr.last.aborted).toBe(true)
  })

  it('rejette tout de suite si le signal est déjà annulé', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(xhrFetch('u', { method: 'POST', headers: {}, body: form(), signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
