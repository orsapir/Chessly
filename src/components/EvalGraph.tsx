import { CLASSIFICATION_META } from '../lib/evaluate'
import type { AnalyzedMove, Classification } from '../lib/types'

interface Props {
  moves: AnalyzedMove[]
  currentPly: number
  onSelect: (ply: number) => void
}

const WIDTH = 360
const HEIGHT = 84

/** Room at each end so a dot on the first or last move is not half cut off. */
const INSET = 5

/** Worth a dot on the curve: the moves someone would want to find again. */
const MARKED: Classification[] = ['brilliant', 'great', 'blunder', 'mistake', 'miss']

/**
 * Win percentage for White across the game. The shape of this curve is usually
 * the whole story: who was ever better, and where it turned.
 *
 * The viewBox keeps its aspect ratio rather than being stretched to the
 * panel's width, so the dots on it stay round.
 */
export function EvalGraph({ moves, currentPly, onSelect }: Props) {
  if (!moves.length) return null

  const points = moves.map((move, index) => {
    const white = move.color === 'white' ? move.winAfter : 100 - move.winAfter
    return {
      x: INSET + (index / Math.max(1, moves.length - 1)) * (WIDTH - INSET * 2),
      y: HEIGHT - (white / 100) * HEIGHT,
      move,
    }
  })

  const first = points[0]
  const last = points[points.length - 1]
  const curve = smooth(points)
  // The curve is inset at both ends; the fill under it runs to the edges, so
  // the first and last move do not leave a sliver of the other colour.
  const area =
    `M0 ${round(first.y)} L${round(first.x)} ${round(first.y)} ${curve} ` +
    `L${WIDTH} ${round(last.y)} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`
  const marked = points.filter(({ move }) => MARKED.includes(move.classification))
  const current = points[Math.min(Math.max(currentPly - 1, 0), points.length - 1)]

  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    onSelect(Math.min(moves.length, Math.max(1, Math.round(ratio * (moves.length - 1)) + 1)))
  }

  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Evaluation across the game"
      onClick={pick}
    >
      <rect width={WIDTH} height={HEIGHT} className="graph-black" />
      <path d={area} className="graph-white" />
      <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} className="graph-mid" />

      {currentPly > 0 && current && (
        <g className="graph-cursor">
          <line x1={current.x} y1={0} x2={current.x} y2={HEIGHT} />
          <circle cx={current.x} cy={current.y} r={3.2} />
        </g>
      )}

      {marked.map(({ x, y, move }) => (
        <circle
          key={move.ply}
          className="graph-mark"
          cx={x}
          cy={y}
          r={4}
          fill={CLASSIFICATION_META[move.classification].color}
        >
          <title>
            {`${move.moveNumber}${move.color === 'white' ? '.' : '…'} ${move.san} — ${
              CLASSIFICATION_META[move.classification].label
            }`}
          </title>
        </circle>
      ))}
    </svg>
  )
}

/**
 * The path through the points with the corners taken off, without its opening
 * move-to so the caller can start it where it likes: cubic segments whose
 * handles sit halfway between neighbours, which follows the data exactly at
 * every point while reading as a curve rather than a saw.
 */
function smooth(points: { x: number; y: number }[]): string {
  const segments: string[] = []
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    if (points.length < 3) {
      segments.push(`L${round(to.x)} ${round(to.y)}`)
      continue
    }
    const midX = round((from.x + to.x) / 2)
    segments.push(`C${midX} ${round(from.y)} ${midX} ${round(to.y)} ${round(to.x)} ${round(to.y)}`)
  }
  return segments.join(' ')
}

const round = (value: number) => Math.round(value * 10) / 10
