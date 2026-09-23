/**
 * Local storage that cannot take the page down with it.
 *
 * Safari with "Block All Cookies", private windows on some versions, and a
 * number of in-app browsers throw a SecurityError on *any* access to
 * `localStorage` - including reading `.length`. A throw inside a render kills
 * the whole app, which looks to the user like a page whose buttons do nothing.
 *
 * When the real thing is unavailable we fall back to memory: preferences and
 * cached reports then last as long as the tab does, which is a far better
 * failure than a blank screen.
 */
const fallback = new Map<string, string>()

let resolved: Storage | null | undefined

function store(): Storage | null {
  if (resolved !== undefined) return resolved
  try {
    const candidate = window.localStorage
    // Reading is not enough: some browsers only throw on write.
    const probe = '__chessly_probe__'
    candidate.setItem(probe, '1')
    candidate.removeItem(probe)
    resolved = candidate
  } catch {
    resolved = null
  }
  return resolved
}

/** True when preferences and cached reports will survive a reload. */
export function isPersistent(): boolean {
  return store() !== null
}

export function readItem(key: string): string | null {
  const target = store()
  if (!target) return fallback.get(key) ?? null
  try {
    return target.getItem(key)
  } catch {
    return null
  }
}

/** Returns false when the write did not stick - a full quota, most likely. */
export function writeItem(key: string, value: string): boolean {
  const target = store()
  if (!target) {
    fallback.set(key, value)
    return true
  }
  try {
    target.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(key: string): void {
  const target = store()
  if (!target) {
    fallback.delete(key)
    return
  }
  try {
    target.removeItem(key)
  } catch {
    /* nothing to do */
  }
}

/** Every stored key starting with `prefix`. */
export function keysWithPrefix(prefix: string): string[] {
  const target = store()
  if (!target) return [...fallback.keys()].filter((key) => key.startsWith(prefix))
  const found: string[] = []
  try {
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i)
      if (key?.startsWith(prefix)) found.push(key)
    }
  } catch {
    return []
  }
  return found
}
