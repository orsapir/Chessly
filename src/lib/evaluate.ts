import type { Classification, Color, Score } from './types'

/** Scores beyond this are all "completely winning" as far as win% is concerned. */
const CP_CLAMP = 1000

export function cpOf(score: Score): number {
  if (score.mate !== null) return score.mate > 0 ? CP_CLAMP + 1 : -CP_CLAMP - 1
  return Math.max(-CP_CLAMP, Math.min(CP_CLAMP, score.cp))
}

/**
 * Expected score for White, 0-100. This is Lichess's logistic fit of win
 * probability against centipawns; it is what makes "-4 to -6" count as a much
 * smaller mistake than "+0.2 to -1.8".
 */
export function winPercent(score: Score, color: Color = 'white'): number {
  let white: number
  if (score.mate !== null) {
    white = score.mate > 0 ? 100 : 0
  } else {
    const cp = cpOf(score)
    white = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
  }
  const clamped = Math.max(0, Math.min(100, white))
  return color === 'white' ? clamped : 100 - clamped
}

export function negate(score: Score): Score {
  return score.mate !== null ? { cp: null, mate: -score.mate } : { cp: -score.cp, mate: null }
}

export function formatScore(score: Score, color: Color = 'white'): string {
  if (score.mate !== null) {
    const mate = color === 'white' ? score.mate : -score.mate
    return `${mate >= 0 ? 'M' : '-M'}${Math.abs(mate)}`
  }
  const cp = color === 'white' ? score.cp : -score.cp
  const pawns = cp / 100
  return `${pawns >= 0 ? '+' : '−'}${Math.abs(pawns).toFixed(2)}`
}

/**
 * The same score with one decimal instead of two, for the narrow bar beside
 * the board where "+0.72" does not fit and the second digit says nothing.
 */
export function formatScoreCompact(score: Score, color: Color = 'white'): string {
  if (score.mate !== null) return formatScore(score, color)
  const pawns = (color === 'white' ? score.cp : -score.cp) / 100
  return `${pawns >= 0 ? '+' : '−'}${Math.abs(pawns).toFixed(1)}`
}

/** Per-move accuracy from the win% given up, 0-100 (Lichess's curve). */
export function moveAccuracy(loss: number): number {
  const accuracy = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669
  return Math.max(0, Math.min(100, accuracy))
}

/**
 * Game accuracy: the mean of a volatility-weighted mean and a harmonic mean of
 * the per-move accuracies. Weighting by volatility keeps quiet, already-decided
 * positions from inflating the number; the harmonic mean keeps one blunder from
 * being averaged away.
 */
export function gameAccuracy(accuracies: number[], winPercents: number[]): number {
  if (!accuracies.length) return 100

  const windowSize = Math.max(2, Math.min(8, Math.ceil(winPercents.length / 10)))
  const weights = accuracies.map((_, index) => {
    const from = Math.max(0, index - windowSize)
    const slice = winPercents.slice(from, index + 1)
    const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length
    const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / slice.length
    return Math.max(0.5, Math.min(12, Math.sqrt(variance)))
  })

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  const weighted = accuracies.reduce((sum, value, index) => sum + value * weights[index], 0) / weightSum
  const harmonic = accuracies.length / accuracies.reduce((sum, value) => sum + 1 / Math.max(value, 1), 0)

  return Math.max(0, Math.min(100, (weighted + harmonic) / 2))
}

/**
 * A rough playing strength implied by one game's accuracy. Calibrated against
 * typical online play rather than derived from anything official - it is a
 * conversation starter, not a rating.
 */
export function estimatedRating(accuracy: number, acpl: number): number {
  const fromAccuracy = (accuracy - 38) * 46
  const fromAcpl = 2950 * Math.exp(-0.0125 * acpl)
  const blended = 0.6 * fromAccuracy + 0.4 * fromAcpl
  return Math.round(Math.max(250, Math.min(2900, blended)) / 10) * 10
}

export interface ClassifyInput {
  /** Win% for the mover before playing. */
  winBefore: number
  /** Win% for the mover after playing. */
  winAfter: number
  /**
   * Whether this was the only move that held the position: the runner-up was
   * far enough behind to change the standing of the game. Measured on the
   * scan's two-line search, where both numbers come from one search.
   */
  onlyMove: boolean
  playedUci: string
  bestUci: string | null
  bestScore: Score
  /** Mover's colour, used to read `bestScore`. */
  color: Color
  legalMoveCount: number
  inBook: boolean
  /** Centipawns of material the move gives up beyond recapture. */
  sacrifice: number
}

export const CLASSIFICATION_ORDER: Classification[] = [
  'brilliant',
  'great',
  'best',
  'excellent',
  'good',
  'book',
  'forced',
  'inaccuracy',
  'miss',
  'mistake',
  'blunder',
]

/**
 * How far the search of a position and the search of what follows it may
 * disagree before the difference is treated as a real loss rather than noise.
 */
export const BEST_DISAGREEMENT = 2

/** Material, in centipawns, a move must give up before it can be brilliant. */
export const BRILLIANT_SACRIFICE = 180

/** Losing / unclear / winning, as far as a human would describe the position. */
export function standing(win: number): 0 | 1 | 2 {
  if (win < 35) return 0
  if (win < 65) return 1
  return 2
}

/**
 * Was the best move the only one that held? True when the runner-up is far
 * enough behind to put the game in a different state. Both numbers must come
 * from the same search, or the gap is meaningless.
 */
export function isOnlyMove(winBest: number, winSecond: number): boolean {
  return winBest - winSecond >= 20 && standing(winBest) > standing(winSecond)
}

/** Thresholds are in win% given up by the move. */
export function classify(input: ClassifyInput): Classification {
  const loss = Math.max(0, input.winBefore - input.winAfter)
  const playedBest = input.bestUci !== null && input.playedUci === input.bestUci

  if (input.legalMoveCount <= 1) return 'forced'
  if (input.inBook) return 'book'

  // A sound sacrifice that stays best and keeps the game at least balanced.
  // Giving material back while already completely winning is technique, not
  // brilliance, so a player who was crushing beforehand does not qualify.
  if (
    input.sacrifice >= BRILLIANT_SACRIFICE &&
    loss <= 2 &&
    input.winAfter >= 50 &&
    input.winBefore < 92 &&
    input.winBefore > 8
  ) {
    return 'brilliant'
  }

  // The one move that holds the position together: everything else drops off.
  if (playedBest && loss <= 1 && input.onlyMove && input.winAfter >= 25 && input.winBefore < 92) {
    return 'great'
  }

  // Playing the engine's move settles it only while the two searches roughly
  // agree. Past that the number on the board has moved, whoever picked the
  // move, and a verdict that ignores it is the one a player catches.
  if (loss <= 0.5 || (playedBest && loss < BEST_DISAGREEMENT)) return 'best'
  if (loss < 2) return 'excellent'
  if (loss < 5) return 'good'

  // Squandering a win while staying out of trouble reads as a missed chance
  // rather than a plain error.
  const hadMate = input.bestScore.mate !== null && (input.color === 'white' ? input.bestScore.mate : -input.bestScore.mate) > 0
  if ((hadMate || input.winBefore >= 85) && loss >= 5 && input.winAfter >= 45) return 'miss'

  if (loss < 10) return 'inaccuracy'
  if (loss < 20) return 'mistake'
  return 'blunder'
}

export const CLASSIFICATION_META: Record<
  Classification,
  { label: string; verdict: string; glyph: string; color: string; blurb: string; countsAsMistake?: boolean }
> = {
  brilliant: { label: 'Brilliant', verdict: 'is brilliant', glyph: '!!', color: '#1cbaba', blurb: 'A sacrifice that works.' },
  great: { label: 'Great', verdict: 'is a great find', glyph: '!', color: '#5c8bb0', blurb: 'The only move that keeps it.' },
  best: { label: 'Best', verdict: 'is best', glyph: '★', color: '#7fa650', blurb: "The engine's first choice." },
  excellent: { label: 'Excellent', verdict: 'is excellent', glyph: '✓', color: '#96bc4b', blurb: 'As good as the best move.' },
  good: { label: 'Good', verdict: 'is good', glyph: '✓', color: '#96af8b', blurb: 'Reasonable, if not the sharpest.' },
  book: { label: 'Book', verdict: 'is book', glyph: '📖', color: '#a88865', blurb: 'Known opening theory.' },
  forced: { label: 'Forced', verdict: 'is forced', glyph: '→', color: '#9c9c9c', blurb: 'Nothing else was legal.' },
  inaccuracy: { label: 'Inaccuracy', verdict: 'is an inaccuracy', glyph: '?!', color: '#f7c631', blurb: 'Lets some of the advantage slip.', countsAsMistake: true },
  miss: { label: 'Miss', verdict: 'is a miss', glyph: '✗', color: '#ee6b55', blurb: 'A winning chance went by.', countsAsMistake: true },
  mistake: { label: 'Mistake', verdict: 'is a mistake', glyph: '?', color: '#ffa459', blurb: 'Hands the opponent real chances.', countsAsMistake: true },
  blunder: { label: 'Blunder', verdict: 'is a blunder', glyph: '??', color: '#fa412d', blurb: 'Changes the result of the game.', countsAsMistake: true },
}
