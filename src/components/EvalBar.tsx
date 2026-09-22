import { formatScore, winPercent } from '../lib/evaluate'
import type { Color, Score } from '../lib/types'

/** The vertical white/black bar beside the board. */
export function EvalBar({ score, orientation }: { score: Score; orientation: Color }) {
  const white = winPercent(score, 'white')
  const share = orientation === 'white' ? white : 100 - white
  const label = formatScore(score, 'white')
  const leader = white >= 50 ? 'white' : 'black'

  return (
    <div className="eval-bar" title={`${label} for White`}>
      <div className={`eval-fill eval-${orientation}`} style={{ height: `${share}%` }} />
      <span className={`eval-label eval-label-${leader === orientation ? 'near' : 'far'}`}>{label}</span>
    </div>
  )
}
