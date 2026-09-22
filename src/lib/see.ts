import { Chess, type Square } from 'chess.js'

const VALUE: Record<string, number> = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 20000 }

/**
 * Static exchange evaluation on one square: how much material the side to move
 * wins by starting the capture sequence there, assuming both sides take with
 * their least valuable piece and can walk away at any point.
 */
function seeSquare(chess: Chess, square: Square): number {
  const captures = chess
    .moves({ verbose: true })
    .filter((move) => move.to === square && move.captured)
  if (!captures.length) return 0

  captures.sort((a, b) => VALUE[a.piece] - VALUE[b.piece])
  const capture = captures[0]
  const gain = VALUE[capture.captured as string] + promotionBonus(capture.promotion)

  chess.move(capture)
  const net = Math.max(0, gain - seeSquare(chess, square))
  chess.undo()
  return net
}

function promotionBonus(promotion?: string): number {
  return promotion ? VALUE[promotion] - VALUE.p : 0
}

/** The most material the side to move can win with a single capture sequence. */
function bestCaptureGain(chess: Chess): number {
  const targets = new Set(
    chess
      .moves({ verbose: true })
      .filter((move) => move.captured)
      .map((move) => move.to),
  )
  let best = 0
  for (const target of targets) best = Math.max(best, seeSquare(chess, target))
  return best
}

/**
 * Material, in centipawns, that a move gives up beyond what it wins back.
 * Positive means the mover is offering something: the test for a sacrifice.
 */
export function sacrificeValue(fenBefore: string, uci: string): number {
  const chess = new Chess(fenBefore)
  const move = chess.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  })
  if (!move) return 0

  const won = move.captured ? VALUE[move.captured] : 0
  const exposed = bestCaptureGain(chess)
  return exposed - won - promotionBonus(move.promotion)
}
