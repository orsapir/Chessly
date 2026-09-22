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

export type Preset = 'fast' | 'balanced' | 'deep'

export const PRESETS: Record<Preset, { label: string; depth: number; detail: string }> = {
  fast: { label: 'Fast', depth: 12, detail: 'A quick pass, a few seconds a game.' },
  balanced: { label: 'Balanced', depth: 14, detail: 'The default. Catches what decides club games.' },
  deep: { label: 'Deep', depth: 17, detail: 'Slow and stubborn. For a game you care about.' },
}

export interface AnalyzeOptions {
  preset?: Preset
  onProgress?: (done: number, total: number) => void
  /** Return true to abort partway through. */
  shouldStop?: () => boolean
}

/** Book plies are shallow: nobody needs depth 18 to confirm 1. e4 is playable. */
const BOOK_SEARCH_DEPTH = 10

export async function analyzeGame(
  pgn: string,
  engine: Analyser,
  options: AnalyzeOptions = {},
): Promise<GameReport> {
  const { preset = 'balanced', onProgress, shouldStop } = options
  const { depth } = PRESETS[preset]
  const game = parseGame(pgn)
  const sans = game.moves.map((move) => move.san)

  // How far theory reaches, so those positions can be searched shallowly.
  let bookPlies = 0
  while (bookPlies < sans.length && lookupBook(sans.slice(0, bookPlies + 1)).inBook) bookPlies++

  const total = game.positions.length
  const evals: (PositionEval | null)[] = new Array(total).fill(null)

  // Positions are independent searches, so hand them out to every engine we
  // have and let each pull the next one as it finishes.
  let cursor = 0
  let done = 0
  let aborted = false

  const consume = async () => {
    while (true) {
      const index = cursor++
      if (index >= total || aborted) return
      if (shouldStop?.()) {
        aborted = true
        return
      }
      const fen = game.positions[index]
      const terminal = terminalScore(fen)
      evals[index] = terminal
        ? { fen, lines: [{ multipv: 1, depth: 0, score: terminal, pv: [] }], depth: 0 }
        : await engine.analyse(fen, {
            depth: index < bookPlies ? Math.min(BOOK_SEARCH_DEPTH, depth) : depth,
            multiPV: 2,
            maxTimeMs: 20000,
          })
      onProgress?.(++done, total)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(engine.concurrency, total)) }, consume),
  )
  if (aborted) throw new AnalysisAborted()

  const moves: AnalyzedMove[] = game.moves.map((move, ply) =>
    describeMove({ move, ply, before: evals[ply], after: evals[ply + 1], sans }),
  )

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
    depth,
    engine: engine.name,
    analyzedAt: Date.now(),
  }
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
