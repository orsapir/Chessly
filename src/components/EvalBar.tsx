import { formatScore, formatScoreCompact, winPercent } from '../lib/evaluate'
import type { Color, Score } from '../lib/types'

interface Props {
  score: Score
  orientation: Color
  /** Dimmed while the number is still the shallow pass's guess. */
  provisional?: boolean
}

/**
 * The bar beside the board: white below, black above, and the boundary between
 * them is the evaluation. It is split by win percentage rather than raw
 * centipawns, so a queen up and a rook up both read as "winning" instead of
 * pinning the bar at the same place.
 */
export function EvalBar({ score, orientation, provisional }: Props) {
  const white = winPercent(score, 'white')
  // Whichever colour is at the bottom of the board is at the bottom of the bar.
  const bottomIsWhite = orientation === 'white'
  const bottomShare = bottomIsWhite ? white : 100 - white
  const label = formatScoreCompact(score, 'white')
  const exact = formatScore(score, 'white')

  // The number sits inside whichever side is ahead, the way a player expects
  // to read it: a positive score against White's block, a negative one against
  // Black's. Which end of the bar that is depends on how the board is turned.
  const whiteAhead = white >= 50
  const labelAtBottom = whiteAhead === bottomIsWhite

  return (
    <div
      className={`eval-bar${bottomIsWhite ? '' : ' flipped'}${provisional ? ' provisional' : ''}`}
      title={`${exact} for White`}
      role="img"
      aria-label={`Evaluation ${exact} for White`}
    >
      <div className="eval-fill" style={{ height: `${bottomShare}%` }} />
      <span className="eval-middle" />
      <span className={`eval-label${labelAtBottom ? '' : ' at-top'}${whiteAhead ? '' : ' on-black'}`}>
        {label}
      </span>
    </div>
  )
}
