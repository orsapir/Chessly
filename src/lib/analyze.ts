import { Chess } from 'chess.js'
import type { Analyser } from './engine'
import {
  CLASSIFICATION_ORDER,
  classify,
  cpOf,
  gameAccuracy,
  estimatedRating,
  moveAccuracy,
  winPercent,
} from './evaluate'
import { detectOpening, lookupBook } from './openings'
import { sacrificeValue } from './see'
import type {
  AnalyzedMove,
  Classification,
  Color,
  GameReport,
  PlayerReport,
  PositionEval,
  Score,
} from './types'

export interface ParsedGame {
  headers: Record<string, string>
  /** One entry per ply. */
  moves: { san: string; uci: string; color: Color; fenBefore: string; fenAfter: string }[]
  /** `positions[i]` is the position before ply `i`; the last entry is the final position. */
  positions: string[]
  result: string
}

export function parseGame(pgn: string): ParsedGame {
  const chess = new Chess()
  chess.loadPgn(pgn)
  const headers = chess.getHeaders()
  const history = chess.history({ verbose: true })

  const moves = history.map((move) => ({
    san: move.san,
    uci: move.lan,
    color: (move.color === 'w' ? 'white' : 'black') as Color,
    fenBefore: move.before,
    fenAfter: move.after,
  }))

  const positions = moves.length
    ? [moves[0].fenBefore, ...moves.map((move) => move.fenAfter)]
    : [chess.fen()]

  return { headers, moves, positions, result: headers.Result ?? '*' }
}

export const MIN_DEPTH = 8
export const MAX_DEPTH = 24

export interface AnalysisSettings {
  /** Depth the verdicts are made at. */
  depth: number
  /**
   * Depth of the first pass over every position. Below `depth` this turns the
   * run into a scan followed by a deep look at the moves that matter; equal to
   * `depth` it searches the whole game uniformly.
   */
  scanDepth: number
}

export const PRESETS: { label: string; depth: number; detail: string }[] = [
  { label: 'Quick', depth: 12, detail: 'A few seconds. Finds the blunders.' },
  { label: 'Review', depth: 18, detail: 'The default. What decides club games.' },
  { label: 'Deep', depth: 22, detail: 'Slow and stubborn, for a game you care about.' },
]

/** Scanning deeper than this buys little; the deep pass is where depth pays. */
const MAX_SCAN_DEPTH = 13

/** Below this, a uniform search is cheap enough that two passes are pointless. */
const TWO_PASS_FROM = 15

export function settingsFor(depth: number): AnalysisSettings {
  const clamped = Math.round(Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, depth)))
  return {
    depth: clamped,
    scanDepth: clamped >= TWO_PASS_FROM ? Math.min(MAX_SCAN_DEPTH, clamped - 3) : clamped,
  }
}

/** A stable string for cache keys and for telling two runs apart. */
export function settingsKey(settings: AnalysisSettings): string {
  return settings.scanDepth < settings.depth ? `s${settings.scanDepth}d${settings.depth}` : `d${settings.depth}`
}

export type Phase = 'scan' | 'deep'

export interface AnalyzeOptions {
  settings?: AnalysisSettings
  onProgress?: (done: number, total: number, phase: Phase) => void
  /** Return true to abort partway through. */
  shouldStop?: () => boolean
}

/** Book plies are shallow: nobody needs depth 20 to confirm 1. e4 is playable. */
const BOOK_SEARCH_DEPTH = 10

/**
 * How much win percentage a move has to put in doubt before it earns a
 * full-depth search: the boundary below which a move is simply "excellent".
 */
const CLOSER_LOOK_LOSS = 2

/** A big gap to the runner-up means the choice itself was the moment. */
const CLOSER_LOOK_GAP = 12

/**
 * Ceiling on how much of the game the deep pass may re-search. Without it a
 * wild game nominates nearly every position and the scan becomes dead weight;
 * with it, a two-pass run always costs less than searching everything deeply.
 */
const DEEP_PASS_BUDGET = 0.35

export async function analyzeGame(
  pgn: string,
  engine: Analyser,
  options: AnalyzeOptions = {},
): Promise<GameReport> {
  const { settings = settingsFor(18), onProgress, shouldStop } = options
  const game = parseGame(pgn)
  const sans = game.moves.map((move) => move.san)

  // How far theory reaches, so those positions can be searched shallowly.
  let bookPlies = 0
  while (bookPlies < sans.length && lookupBook(sans.slice(0, bookPlies + 1)).inBook) bookPlies++

  const total = game.positions.length
  const scan: (PositionEval | null)[] = new Array(total).fill(null)
  const deep: (PositionEval | null)[] = new Array(total).fill(null)

  const search = async (indices: number[], depth: number, into: (PositionEval | null)[], phase: Phase) => {
    let cursor = 0
    let done = 0
    // Positions are independent searches, so hand them out to every engine we
    // have and let each pull the next one as it finishes.
    const consume = async () => {
      while (true) {
        const slot = cursor++
        if (slot >= indices.length) return
        if (shouldStop?.()) throw new AnalysisAborted()
        const index = indices[slot]
        const fen = game.positions[index]
        const terminal = terminalScore(fen)
        into[index] = terminal
          ? { fen, lines: [{ multipv: 1, depth: 0, score: terminal, pv: [] }], depth: 0 }
          : await engine.analyse(fen, {
              // Book positions are settled; spending depth on them is waste.
              depth: index < bookPlies ? Math.min(BOOK_SEARCH_DEPTH, depth) : depth,
              multiPV: 2,
              maxTimeMs: 30000,
            })
        onProgress?.(++done, indices.length, phase)
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(engine.concurrency, indices.length)) }, consume),
    )
  }

  const everyPosition = Array.from({ length: total }, (_, index) => index)
  await search(everyPosition, settings.scanDepth, scan, 'scan')

  // Second pass: only where the scan saw something worth being sure about,
  // most significant first and bounded, so this never costs more than simply
  // searching the whole game deeply. Both ends of a move are re-searched
  // together, so a verdict never compares a shallow evaluation against a deep
  // one.
  if (settings.scanDepth < settings.depth) {
    const candidates = game.moves
      .map((move, ply) => ({ ply, weight: closerLookWeight(move, ply, scan, sans) }))
      .filter((candidate) => candidate.weight > 0)
      .sort((a, b) => b.weight - a.weight)

    const budget = Math.max(2, Math.round(total * DEEP_PASS_BUDGET))
    const wanted = new Set<number>()
    for (const { ply } of candidates) {
      if (wanted.size >= budget) break
      wanted.add(ply)
      wanted.add(ply + 1)
    }

    const indices = [...wanted].filter((index) => index < total).sort((a, b) => a - b)
    if (indices.length) await search(indices, settings.depth, deep, 'deep')
  }

  const moves: AnalyzedMove[] = game.moves.map((move, ply) => {
    // Use the deep pass only where it covers both ends of the move at the same
    // depth. Anything else would compare a deep evaluation against a shallow
    // one, which is how a quiet move ends up labelled a blunder.
    const useDeep = comparable(deep[ply], deep[ply + 1])
    const before = (useDeep ? deep[ply] : scan[ply]) ?? null
    const after = (useDeep ? deep[ply + 1] : scan[ply + 1]) ?? null
    return describeMove({ move, ply, before, after, sans })
  })

  return {
    moves,
    white: summarize(moves, 'white'),
    black: summarize(moves, 'black'),
    opening: detectOpening(sans),
    turningPoints: moves
      .filter((move) => move.loss >= 10)
      .sort((a, b) => b.loss - a.loss)
      .slice(0, 3)
      .map((move) => move.ply),
    settings,
    engine: engine.name,
    analyzedAt: Date.now(),
  }
}

/**
 * Whether two searches can be compared: both present, and either searched to
 * the same depth or exact (mate and stalemate carry depth 0 and are true at
 * any depth).
 */
function comparable(before: PositionEval | null, after: PositionEval | null): boolean {
  if (!before || !after) return false
  return before.depth === after.depth || before.depth === 0 || after.depth === 0
}

/**
 * How badly a move wants a full-depth search, judged from the shallow scan.
 * Zero means leave it alone. Larger means look here first: what a player most
 * wants explained is what cost them the most.
 */
function closerLookWeight(
  move: ParsedGame['moves'][number],
  ply: number,
  scan: (PositionEval | null)[],
  sans: string[],
): number {
  if (lookupBook(sans.slice(0, ply + 1)).inBook) return 0

  const before = scan[ply]
  const after = scan[ply + 1]
  const bestScore = before?.lines[0]?.score
  const playedScore = after?.lines[0]?.score
  // No usable scan for this move: treat it as worth a proper look.
  if (!bestScore || !playedScore) return 100

  const winBefore = winPercent(bestScore, move.color)
  const playedBest = before?.lines[0]?.pv[0] === move.uci
  const loss = playedBest ? 0 : Math.max(0, winBefore - winPercent(playedScore, move.color))
  if (loss >= CLOSER_LOOK_LOSS) return loss

  const second = before?.lines[1]
  const gap = second ? winBefore - winPercent(second.score, move.color) : 0
  if (gap >= CLOSER_LOOK_GAP) return CLOSER_LOOK_LOSS + gap / 10

  // A material offer the scan rated fine is exactly the kind of move a shallow
  // search gets wrong, so it is worth confirming - but it is not an error, so
  // it queues behind anything that actually cost something.
  return sacrificeValue(move.fenBefore, move.uci) >= 180 ? CLOSER_LOOK_LOSS / 2 : 0
}

export class AnalysisAborted extends Error {
  constructor() {
    super('Analysis cancelled')
    this.name = 'AnalysisAborted'
  }
}

/** Mate and stalemate get exact scores rather than an engine search. */
function terminalScore(fen: string): Score | null {
  const chess = new Chess(fen)
  if (chess.isCheckmate()) return { cp: null, mate: chess.turn() === 'w' ? -1 : 1 }
  if (chess.isGameOver()) return { cp: 0, mate: null }
  return null
}

interface DescribeInput {
  move: ParsedGame['moves'][number]
  ply: number
  before: PositionEval | null
  after: PositionEval | null
  sans: string[]
}

/** The depth a verdict actually rests on: the shallower of its two searches. */
function verdictDepth(before: PositionEval | null, after: PositionEval | null): number {
  const depths = [before?.depth, after?.depth].filter((depth): depth is number => typeof depth === 'number' && depth > 0)
  return depths.length ? Math.min(...depths) : 0
}

function describeMove({ move, ply, before, after, sans }: DescribeInput): AnalyzedMove {
  const color = move.color
  const neutral: Score = { cp: 0, mate: null }
  const bestScore = before?.lines[0]?.score ?? neutral
  const playedScore = after?.lines[0]?.score ?? neutral
  const bestMoveUci = before?.lines[0]?.pv[0] ?? null

  const winBefore = winPercent(bestScore, color)
  const playedBest = bestMoveUci !== null && bestMoveUci === move.uci
  // Two searches of the same position can disagree by a fraction of a percent;
  // when the player found the engine's move there is nothing to charge them for.
  const winAfter = playedBest ? winBefore : winPercent(playedScore, color)
  const loss = Math.max(0, winBefore - winAfter)

  const secondLine = before?.lines[1]
  const winSecond = secondLine ? winPercent(secondLine.score, color) : null

  const sign = color === 'white' ? 1 : -1
  const cpLoss = playedBest
    ? 0
    : Math.min(1000, Math.max(0, cpOf(bestScore) * sign - cpOf(playedScore) * sign))

  const { inBook, name } = lookupBook(sans.slice(0, ply + 1))
  const legalMoveCount = new Chess(move.fenBefore).moves().length

  // Only worth the work when the move is good enough to be brilliant.
  const sacrifice = loss <= 2 && !inBook ? sacrificeValue(move.fenBefore, move.uci) : 0

  const classification = classify({
    winBefore,
    winAfter,
    winSecond,
    playedUci: move.uci,
    bestUci: bestMoveUci,
    bestScore,
    color,
    legalMoveCount,
    inBook,
    sacrifice,
  })

  return {
    ply,
    moveNumber: Math.floor(ply / 2) + 1,
    color,
    san: move.san,
    uci: move.uci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    score: playedScore,
    bestScore,
    bestMoveUci,
    bestMoveSan: bestMoveUci ? toSan(move.fenBefore, bestMoveUci) : null,
    bestLineSan: before?.lines[0]?.pv ? lineToSan(move.fenBefore, before.lines[0].pv) : [],
    winBefore,
    winAfter,
    loss,
    cpLoss,
    depth: verdictDepth(before, after),
    accuracy: moveAccuracy(loss),
    classification,
    opening: inBook ? (name ?? undefined) : undefined,
    sacrifice: sacrifice > 0 ? sacrifice : undefined,
  }
}

export function toSan(fen: string, uci: string): string | null {
  try {
    const chess = new Chess(fen)
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    })
    return move?.san ?? null
  } catch {
    return null
  }
}

export function lineToSan(fen: string, uciMoves: string[], limit = 8): string[] {
  const chess = new Chess(fen)
  const sans: string[] = []
  for (const uci of uciMoves.slice(0, limit)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      })
      if (!move) break
      sans.push(move.san)
    } catch {
      break
    }
  }
  return sans
}

function emptyCounts(): Record<Classification, number> {
  return Object.fromEntries(CLASSIFICATION_ORDER.map((key) => [key, 0])) as Record<Classification, number>
}

function summarize(moves: AnalyzedMove[], color: Color): PlayerReport {
  const own = moves.filter((move) => move.color === color)
  const counts = emptyCounts()
  for (const move of own) counts[move.classification]++

  // Book and forced moves were never a decision, so they do not move the needle.
  const decided = own.filter((move) => move.classification !== 'book' && move.classification !== 'forced')
  const accuracies = decided.map((move) => move.accuracy)
  const winPercents = decided.map((move) => move.winAfter)

  const acpl = decided.length
    ? decided.reduce((sum, move) => sum + move.cpLoss, 0) / decided.length
    : 0

  const accuracy = gameAccuracy(accuracies, winPercents)

  return {
    accuracy,
    acpl: Math.round(acpl),
    // A short, theory-heavy game says nothing about strength; don't pretend it does.
    estimatedRating: decided.length >= 16 ? estimatedRating(accuracy, acpl) : null,
    decidedMoves: decided.length,
    counts,
  }
}
