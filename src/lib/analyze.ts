import { Chess } from 'chess.js'
import type { Analyser } from './engine'
import {
  BRILLIANT_SACRIFICE,
  CLASSIFICATION_ORDER,
  classify,
  cpOf,
  gameAccuracy,
  estimatedRating,
  isOnlyMove,
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
  { label: 'Deep', depth: 24, detail: 'Slow and stubborn, for a game you care about.' },
]

/** Scanning deeper than this buys little; the deep pass is where depth pays. */
const MAX_SCAN_DEPTH = 12

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

/**
 * Whether a brilliancy is even on the table here, by the same standing tests
 * the classifier applies - loose enough to absorb the shallow pass's noise.
 */
function couldBeBrilliant(winBefore: number, winAfter: number): boolean {
  return winAfter >= 45 && winBefore < 95 && winBefore > 5
}

/**
 * Static exchange evaluation is not free and every move is asked about twice -
 * once when choosing what to search deeply, once when describing it.
 */
const sacrificeCache = new Map<string, number>()

function sacrificeAt(move: ParsedGame['moves'][number], ply: number): number {
  const key = `${ply}:${move.uci}`
  let value = sacrificeCache.get(key)
  if (value === undefined) {
    value = sacrificeValue(move.fenBefore, move.uci)
    sacrificeCache.set(key, value)
  }
  return value
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
 * Node ceiling for a search at a given depth, scaled so it stays about three
 * times the median position's cost. A tenth of the positions in a game take
 * half the total time without it; the verdicts on those positions barely move.
 */
export function nodeCapFor(depth: number): number {
  return Math.round(1_000_000 * 2 ** ((depth - 18) / 2))
}

/**
 * Ceiling on how much of the game the deep pass may re-search, at the depth
 * the two-pass mode starts. Without a ceiling a wild game nominates nearly
 * every position and the scan becomes dead weight.
 */
const DEEP_PASS_BUDGET = 0.35

/**
 * The same ceiling, scaled for depth. A position costs roughly twice as much
 * for every two plies, so holding the share fixed would make depth 24 eight
 * times the work of depth 18 - three minutes on a laptop, and nobody waits
 * that out. Spending a roughly constant amount of engine time instead means a
 * deeper setting buys certainty about the moves that matter most rather than a
 * longer wait for the same list. Moves that offer material are exempt and are
 * always searched in full.
 */
function deepPassBudget(depth: number): number {
  const costPerPosition = 2 ** ((depth - TWO_PASS_FROM - 3) / 2)
  return Math.max(0.15, Math.min(DEEP_PASS_BUDGET, DEEP_PASS_BUDGET / costPerPosition))
}

export async function analyzeGame(
  pgn: string,
  engine: Analyser,
  options: AnalyzeOptions = {},
): Promise<GameReport> {
  const { settings = settingsFor(18), onProgress, shouldStop } = options
  const game = parseGame(pgn)
  sacrificeCache.clear()
  const sans = game.moves.map((move) => move.san)

  // How far theory reaches, so those positions can be searched shallowly.
  let bookPlies = 0
  while (bookPlies < sans.length && lookupBook(sans.slice(0, bookPlies + 1)).inBook) bookPlies++

  const total = game.positions.length
  const scan: (PositionEval | null)[] = new Array(total).fill(null)
  const deep: (PositionEval | null)[] = new Array(total).fill(null)

  const search = async (
    indices: number[],
    depth: number,
    into: (PositionEval | null)[],
    phase: Phase,
    multiPV: number,
  ) => {
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
        if (terminal) {
          into[index] = { fen, lines: [{ multipv: 1, depth: 0, score: terminal, pv: [] }], depth: 0, target: 0 }
        } else {
          // Book positions are settled; spending depth on them is waste.
          const wanted = index < bookPlies ? Math.min(BOOK_SEARCH_DEPTH, depth) : depth
          into[index] = await engine.analyse(fen, {
            depth: wanted,
            multiPV,
            maxNodes: nodeCapFor(wanted),
            maxTimeMs: 30000,
          })
        }
        onProgress?.(++done, indices.length, phase)
      }
    }
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(engine.concurrency, indices.length)) }, consume),
    )
  }

  // The scan runs two lines: it is cheap at this depth and the runner-up is
  // what tells us whether a move was the only one that held.
  const everyPosition = Array.from({ length: total }, (_, index) => index)
  await search(everyPosition, settings.scanDepth, scan, 'scan', 2)

  // Second pass: only where the scan saw something worth being sure about,
  // most significant first and bounded, so this never costs more than simply
  // searching the whole game deeply. Both ends of a move are re-searched
  // together, so a verdict never compares a shallow evaluation against a deep
  // one.
  if (settings.scanDepth < settings.depth) {
    const candidates = game.moves.map((move, ply) => ({
      ply,
      ...closerLookWeight(move, ply, scan, sans),
    }))

    const wanted = new Set<number>()
    // A move that offers material is the one case where the shallow pass is
    // least to be trusted and the label at stake - brilliant - is the one
    // nobody wants quietly dropped. These go in whatever the budget says.
    for (const { ply, sacrifice } of candidates) {
      if (!sacrifice) continue
      wanted.add(ply)
      wanted.add(ply + 1)
    }

    const budget = Math.max(2, Math.round(total * deepPassBudget(settings.depth)))
    const ranked = candidates
      .filter((candidate) => candidate.weight > 0 && !candidate.sacrifice)
      .sort((a, b) => b.weight - a.weight)
    for (const { ply } of ranked) {
      if (wanted.size >= budget) break
      wanted.add(ply)
      wanted.add(ply + 1)
    }

    const indices = [...wanted].filter((index) => index < total).sort((a, b) => a - b)
    // One line only: a second costs about a third more, and the only thing it
    // would add - whether the alternative was much worse - the scan already
    // answered on a search where both numbers came from the same place.
    if (indices.length) await search(indices, settings.depth, deep, 'deep', 1)
  }

  const moves: AnalyzedMove[] = game.moves.map((move, ply) => {
    // Use the deep pass only where it covers both ends of the move at the same
    // depth. Anything else would compare a deep evaluation against a shallow
    // one, which is how a quiet move ends up labelled a blunder.
    const useDeep = comparable(deep[ply], deep[ply + 1])
    const before = (useDeep ? deep[ply] : scan[ply]) ?? null
    const after = (useDeep ? deep[ply + 1] : scan[ply + 1]) ?? null
    return describeMove({ move, ply, before, after, sans, onlyMove: onlyMoveAt(scan[ply], move.color) })
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
 * Whether two searches can be compared: both present, and either asked for the
 * same depth or exact (mate and stalemate carry target 0 and hold at any
 * depth). Compared by depth asked for, not depth reached, because the node cap
 * makes the latter vary from position to position.
 */
function comparable(before: PositionEval | null, after: PositionEval | null): boolean {
  if (!before || !after) return false
  return before.target === after.target || before.target === 0 || after.target === 0
}

/**
 * How badly a move wants a full-depth search, judged from the shallow scan.
 * `weight` orders the queue - what a player most wants explained is what cost
 * them the most - while `sacrifice` marks the moves that skip the queue.
 */
function closerLookWeight(
  move: ParsedGame['moves'][number],
  ply: number,
  scan: (PositionEval | null)[],
  sans: string[],
): { weight: number; sacrifice: boolean } {
  if (lookupBook(sans.slice(0, ply + 1)).inBook) return { weight: 0, sacrifice: false }

  const before = scan[ply]
  const after = scan[ply + 1]
  const bestScore = before?.lines[0]?.score
  const playedScore = after?.lines[0]?.score
  // No usable scan for this move: treat it as worth a proper look.
  if (!bestScore || !playedScore) return { weight: 100, sacrifice: false }

  const winBefore = winPercent(bestScore, move.color)
  const playedBest = before?.lines[0]?.pv[0] === move.uci
  const loss = playedBest ? 0 : Math.max(0, winBefore - winPercent(playedScore, move.color))

  // Material offered, the shallow search saw nothing wrong with it, and the
  // game is live enough for the move to be brilliant: only depth can say
  // whether it is that or a blunder. Screening on the brilliance conditions
  // first keeps this from dragging in every loose piece in a won position -
  // and keeps the expensive exchange evaluation off most moves.
  const winAfter = playedBest ? winBefore : winPercent(playedScore, move.color)
  if (
    loss <= 2 &&
    couldBeBrilliant(winBefore, winAfter) &&
    sacrificeAt(move, ply) >= BRILLIANT_SACRIFICE
  ) {
    return { weight: 100, sacrifice: true }
  }

  if (loss >= CLOSER_LOOK_LOSS) return { weight: loss, sacrifice: false }

  const second = before?.lines[1]
  const gap = second ? winBefore - winPercent(second.score, move.color) : 0
  if (gap >= CLOSER_LOOK_GAP) return { weight: CLOSER_LOOK_LOSS + gap / 10, sacrifice: false }

  return { weight: 0, sacrifice: false }
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
  onlyMove: boolean
}

/**
 * Whether the best move here was the only one that held, read off the two-line
 * search so both numbers come from one search rather than two of different
 * depths.
 */
function onlyMoveAt(evaluation: PositionEval | null, color: Color): boolean {
  const best = evaluation?.lines[0]?.score
  const second = evaluation?.lines[1]?.score
  if (!best || !second) return false
  return isOnlyMove(winPercent(best, color), winPercent(second, color))
}

/** The depth a verdict actually rests on: the shallower of its two searches. */
function verdictDepth(before: PositionEval | null, after: PositionEval | null): number {
  const depths = [before?.depth, after?.depth].filter((depth): depth is number => typeof depth === 'number' && depth > 0)
  return depths.length ? Math.min(...depths) : 0
}

function describeMove({ move, ply, before, after, sans, onlyMove }: DescribeInput): AnalyzedMove {
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

  const sign = color === 'white' ? 1 : -1
  const cpLoss = playedBest
    ? 0
    : Math.min(1000, Math.max(0, cpOf(bestScore) * sign - cpOf(playedScore) * sign))

  const { inBook, name } = lookupBook(sans.slice(0, ply + 1))
  const legalMoveCount = new Chess(move.fenBefore).moves().length

  // Only worth the work when the move is good enough to be brilliant.
  const sacrifice = loss <= 2 && !inBook ? sacrificeAt(move, ply) : 0

  const classification = classify({
    winBefore,
    winAfter,
    onlyMove,
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
