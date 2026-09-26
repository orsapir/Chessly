import type { Color } from './types'

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const TAKEN_GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
/** What each side starts with, and what each of those is worth. */
const START_COUNT: [string, number][] = [
  ['q', 1],
  ['r', 2],
  ['b', 2],
  ['n', 2],
  ['p', 8],
]

export interface Material {
  /** The pieces this side has taken, as glyphs, biggest first. */
  white: string
  black: string
  /** Material lead in pawns, for the side that has one. */
  edge: Record<Color, number>
}

/**
 * What each side has taken, read off the position rather than the move list so
 * it is right wherever the board is - including a position reached by trying a
 * move out. `edge` is the material lead in pawns, which is the number a chess
 * site puts beside the pieces. A promotion can leave a side with more of a
 * piece than it started with, so what is missing never goes below zero.
 */
export function capturedMaterial(fen: string): Material {
  const board = fen.split(' ')[0]
  const taken = { white: '', black: '' }
  const held = { white: 0, black: 0 }
  for (const [kind, start] of START_COUNT) {
    for (const color of ['white', 'black'] as const) {
      const letter = color === 'white' ? kind.toUpperCase() : kind
      const left = board.split(letter).length - 1
      held[color] += left * PIECE_VALUE[kind]
      // Whatever is missing from this side was taken by the other one.
      const other = color === 'white' ? 'black' : 'white'
      taken[other] += TAKEN_GLYPH[kind].repeat(Math.max(0, start - left))
    }
  }
  const lead = held.white - held.black
  return {
    white: taken.white,
    black: taken.black,
    edge: { white: Math.max(0, lead), black: Math.max(0, -lead) },
  }
}
