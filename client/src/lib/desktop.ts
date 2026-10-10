// Application de bureau (Tauri) : détection et appel des commandes Rust (desktop/src-tauri).
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

type InvokeArgs = Parameters<typeof import('@tauri-apps/api/core').invoke>[1]

/** Commande Tauri ; import paresseux pour ne rien charger sur le web. */
export async function desktopInvoke<T>(cmd: string, args?: InvokeArgs, headers?: Record<string, string>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args, headers ? { headers } : undefined)
}

/** Message lisible d'une erreur de commande (Tauri rejette avec une chaîne). */
export const errText = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e))
