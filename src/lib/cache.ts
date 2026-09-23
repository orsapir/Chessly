import type { GameReport } from './types'

const PREFIX = 'chessly:report:'
// Bump when the report shape changes, so stale entries are simply ignored.
const VERSION = 'v3'

const keyFor = (gameId: string, settings: string) => `${PREFIX}${VERSION}:${settings}:${gameId}`

export function readReport(gameId: string, settings: string): GameReport | null {
  try {
    const raw = localStorage.getItem(keyFor(gameId, settings))
    return raw ? (JSON.parse(raw) as GameReport) : null
  } catch {
    return null
  }
}

export function writeReport(gameId: string, settings: string, report: GameReport) {
  try {
    localStorage.setItem(keyFor(gameId, settings), JSON.stringify(report))
  } catch {
    // Out of space: drop the oldest half of what we have and try once more.
    evictOldest()
    try {
      localStorage.setItem(keyFor(gameId, settings), JSON.stringify(report))
    } catch {
      /* give up quietly - the cache is a nicety, not a feature */
    }
  }
}

function storedKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  return keys
}

function evictOldest() {
  const entries = storedKeys()
    .map((key) => {
      try {
        return { key, at: (JSON.parse(localStorage.getItem(key) ?? '{}') as GameReport).analyzedAt ?? 0 }
      } catch {
        return { key, at: 0 }
      }
    })
    .sort((a, b) => a.at - b.at)

  for (const entry of entries.slice(0, Math.ceil(entries.length / 2))) {
    localStorage.removeItem(entry.key)
  }
}

export function countCached(): number {
  return storedKeys().length
}

export function clearCache() {
  for (const key of storedKeys()) localStorage.removeItem(key)
}
