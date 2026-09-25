import { OPENING_DATA } from './openings.data'

/**
 * The opening book, from the Lichess opening database (3,815 named lines with
 * their ECO codes). Two questions are asked of it and each gets the structure
 * it deserves:
 *
 * - "Is this still theory?" needs a prefix test. The data is sorted by move
 *   sequence, so a binary search finds whether any known line starts with what
 *   has been played - no need to hold every prefix in memory.
 * - "What is this opening called?" needs exact lookup, which is a plain map.
 */
const LINES = OPENING_DATA.split('\n')

/** Move sequences only, sorted, parallel to LINES. */
const SEQUENCES: string[] = []
/** Move sequence to its name and ECO code. */
const NAMED = new Map<string, { eco: string; name: string }>()

let deepest = 0
for (const line of LINES) {
  const firstTab = line.indexOf('\t')
  const secondTab = line.indexOf('\t', firstTab + 1)
  if (firstTab < 0 || secondTab < 0) continue
  const moves = line.slice(0, firstTab)
  SEQUENCES.push(moves)
  NAMED.set(moves, { eco: line.slice(firstTab + 1, secondTab), name: line.slice(secondTab + 1) })
  const plies = moves.split(' ').length
  if (plies > deepest) deepest = plies
}

/** Longest line the book knows. Naming may go this far. */
export const BOOK_DEPTH = deepest

/**
 * How far a move may still be called "book".
 *
 * The database names every move order anyone has bothered to name, 1. a4
 * included, and its longest lines run past thirty plies. Naming wants all of
 * that. The Book verdict does not: it suppresses a judgement and takes the
 * move out of the accuracy figure, so letting it run to the end of a named
 * line would excuse a bad opening for having a name, and would drop half a
 * theory-heavy game out of the accuracy calculation.
 */
const BOOK_VERDICT_PLIES = 16

/** Index of the first sequence at or after `key`, by binary search. */
function lowerBound(key: string): number {
  let low = 0
  let high = SEQUENCES.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (SEQUENCES[mid] < key) low = mid + 1
    else high = mid
  }
  return low
}

export interface BookMatch {
  inBook: boolean
  name: string | null
}

/**
 * Looks up a position by the SAN moves that reached it. In book means some
 * named line starts with exactly these moves - not that these moves are
 * themselves a named opening.
 */
export function lookupBook(sanMoves: string[]): BookMatch {
  if (!sanMoves.length || sanMoves.length > BOOK_VERDICT_PLIES) return { inBook: false, name: null }
  const key = sanMoves.join(' ')
  const index = lowerBound(key)
  const candidate = SEQUENCES[index]
  if (candidate === undefined) return { inBook: false, name: null }
  if (candidate !== key && !candidate.startsWith(`${key} `)) return { inBook: false, name: null }
  return { inBook: true, name: detectOpening(sanMoves) }
}

/** The most specific opening name the game reached, with its ECO code. */
export function identifyOpening(sanMoves: string[]): { eco: string; name: string } | null {
  for (let plies = Math.min(sanMoves.length, BOOK_DEPTH); plies >= 1; plies--) {
    const hit = NAMED.get(sanMoves.slice(0, plies).join(' '))
    if (hit) return hit
  }
  return null
}

export function detectOpening(sanMoves: string[]): string | null {
  return identifyOpening(sanMoves)?.name ?? null
}
