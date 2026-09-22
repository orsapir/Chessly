export type Color = 'white' | 'black'

/** A classification in the style of Chess.com's Game Review. */
export type Classification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'book'
  | 'forced'
  | 'inaccuracy'
  | 'miss'
  | 'mistake'
  | 'blunder'

/** An engine score, always stored from White's point of view. */
export type Score = { cp: number; mate: null } | { cp: null; mate: number }

export interface EngineLine {
  multipv: number
  depth: number
  score: Score
  /** Principal variation in UCI long algebraic notation. */
  pv: string[]
}

export interface PositionEval {
  fen: string
  /** Best lines, sorted by strength, from the side-to-move's perspective. */
  lines: EngineLine[]
  depth: number
}

export interface AnalyzedMove {
  ply: number
  /** Full-move number as shown in a move list. */
  moveNumber: number
  color: Color
  san: string
  uci: string
  /** Position before the move was played. */
  fenBefore: string
  /** Position after the move was played. */
  fenAfter: string
  /** Score after the move, White's point of view. */
  score: Score
  /** Score of the best available move at this point, White's point of view. */
  bestScore: Score
  /** Engine's preferred move here, in UCI. */
  bestMoveUci: string | null
  /** Engine's preferred move here, in SAN. */
  bestMoveSan: string | null
  /** Principal variation from before the move, in SAN. */
  bestLineSan: string[]
  /** Win percentage for the mover, before and after playing. */
  winBefore: number
  winAfter: number
  /** Win percentage given up by this move (0 = nothing lost). */
  loss: number
  /** Centipawns given up by this move, capped so won positions stay sane. */
  cpLoss: number
  /** Per-move accuracy, 0-100. */
  accuracy: number
  classification: Classification
  /** Opening name, when the move is still inside the book. */
  opening?: string
  /** Material the move gives up, in centipawns, when it is a sacrifice. */
  sacrifice?: number
}

export interface PlayerReport {
  accuracy: number
  /** Average centipawn loss. */
  acpl: number
  /** Rough playing strength implied by this game, or null if too few moves to say. */
  estimatedRating: number | null
  /** Moves that were actually a decision: not book, not forced. */
  decidedMoves: number
  counts: Record<Classification, number>
}

export interface GameReport {
  moves: AnalyzedMove[]
  white: PlayerReport
  black: PlayerReport
  opening: string | null
  /** Plies where the evaluation swung the most, biggest first. */
  turningPoints: number[]
  depth: number
  engine: string
  analyzedAt: number
}

export interface GameSummary {
  id: string
  url: string
  pgn: string
  timeClass: string
  timeControl: string
  rated: boolean
  endTime: number
  rules: string
  white: { username: string; rating: number; result: string }
  black: { username: string; rating: number; result: string }
}
