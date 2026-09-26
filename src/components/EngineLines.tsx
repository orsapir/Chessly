import { formatScore } from '../lib/evaluate'
import type { Score } from '../lib/types'

/** Lines offered, and rows kept clear for them. */
const LINES = 3

export interface EngineLineView {
  score: Score
  /** The line in the notation a player reads, first move first. */
  san: string[]
}

interface Props {
  lines: EngineLineView[]
  depth: number
  /** Ply the board is on, so the line reads with the right move numbers. */
  ply: number
  /** The lines belong to a position that is no longer on the board. */
  stale: boolean
  /** Waiting on the report to finish before the engine is free. */
  busy?: boolean
  /** Play a line's first move onto the board. */
  onPlay: (san: string) => void
}

/**
 * What the engine is actually considering here: its top choices with the score
 * each one leads to. Scores are from White's side, like the bar - a line that
 * reads +1.2 is good for White whoever is to move.
 *
 * The previous position's lines stay up, dimmed, while the next search runs.
 * Blanking the panel between moves makes stepping through a game flicker.
 */
export function EngineLines({ lines, depth, ply, stale, busy, onPlay }: Props) {
  // Always the same three rows, filled or not. The block sits under the board
  // with the page below it, so a row appearing or going as the engine works
  // would shift everything beneath it on every move.
  const slots = Array.from({ length: LINES }, (_, index) => lines[index] ?? null)

  return (
    <div className={`engine-lines${stale ? ' stale' : ''}`}>
      <div className="engine-head">
        <strong>Engine</strong>
        <span>
          {busy
            ? 'free once the report is done'
            : stale
              ? 'thinking…'
              : `top ${lines.length || LINES} at depth ${depth}`}
        </span>
      </div>
      {slots.map((line, index) =>
        line ? (
          <button
            key={index}
            className="engine-line"
            disabled={stale}
            onClick={() => line.san[0] && onPlay(line.san[0])}
            title={line.san[0] && !stale ? `Play ${line.san[0]} on the board` : undefined}
          >
            <span className={`engine-score${scoreSide(line.score)}`}>{formatScore(line.score)}</span>
            <span className="engine-moves">{numbered(line.san, ply)}</span>
          </button>
        ) : (
          <div key={index} className="engine-line empty">
            {index === 0 &&
              (busy ? 'The report has every engine busy.' : stale ? 'Looking…' : 'No moves here — the game is over.')}
          </div>
        ),
      )}
    </div>
  )
}

const scoreSide = (score: Score) =>
  (score.mate ?? score.cp ?? 0) >= 0 ? ' for-white' : ' for-black'

/** "23. Nf3 Qd7 24. Bg2", counting on from where the board is. */
function numbered(san: string[], ply: number): string {
  return san
    .map((move, index) => {
      const at = ply + index
      const white = at % 2 === 0
      const number = Math.floor(at / 2) + 1
      if (white) return `${number}. ${move}`
      return index === 0 ? `${number}… ${move}` : move
    })
    .join(' ')
}
