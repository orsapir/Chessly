import { keysWithPrefix, readItem, removeItem, writeItem } from './storage'
import type { GameReport } from './types'

const PREFIX = 'chessly:report:'
// Bump when the report shape changes, so stale entries are simply ignored.
const VERSION = 'v3'

const keyFor = (gameId: string, settings: string) => `${PREFIX}${VERSION}:${settings}:${gameId}`

export function readReport(gameId: string, settings: string): GameReport | null {
  try {
    const raw = readItem(keyFor(gameId, settings))
    return raw ? (JSON.parse(raw) as GameReport) : null
  } catch {
    return null
  }
}

export function writeReport(gameId: string, settings: string, report: GameReport) {
  const key = keyFor(gameId, settings)
  const payload = JSON.stringify(report)
  if (writeItem(key, payload)) return
  // Out of space: drop the oldest half of what we have and try once more. If
  // that still fails, let it go - the cache is a nicety, not a feature.
  evictOldest()
  writeItem(key, payload)
}

function storedKeys(): string[] {
  return keysWithPrefix(PREFIX)
}

function evictOldest() {
  const entries = storedKeys()
    .map((key) => {
      try {
        return { key, at: (JSON.parse(readItem(key) ?? '{}') as GameReport).analyzedAt ?? 0 }
      } catch {
        return { key, at: 0 }
      }
    })
    .sort((a, b) => a.at - b.at)

  for (const entry of entries.slice(0, Math.ceil(entries.length / 2))) {
    removeItem(entry.key)
  }
}

export function countCached(): number {
  return storedKeys().length
}

export function clearCache() {
  for (const key of storedKeys()) removeItem(key)
}
