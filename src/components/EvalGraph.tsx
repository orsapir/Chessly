import { CLASSIFICATION_META } from '../lib/evaluate'
import type { AnalyzedMove } from '../lib/types'

interface Props {
  moves: AnalyzedMove[]
  currentPly: number
  onSelect: (ply: number) => void
}

const WIDTH = 600
const HEIGHT = 120

/**
 * Win percentage for White across the game. The shape of this curve is usually
 * the whole story: who was ever better, and where it turned.
 */
export function EvalGraph({ moves, currentPly, onSelect }: Props) {
  if (!moves.length) return null

  const points = moves.map((move, index) => {
    const white = move.color === 'white' ? move.winAfter : 100 - move.winAfter
    return { x: (index / Math.max(1, moves.length - 1)) * WIDTH, y: HEIGHT - (white / 100) * HEIGHT, move }
  })

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const area = `${path} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`
  const marked = points.filter(
    ({ move }) => move.classification === 'blunder' || move.classification === 'mistake' || move.classification === 'brilliant',
  )
  const currentX = points[Math.min(Math.max(currentPly - 1, 0), points.length - 1)]?.x ?? 0

  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    onSelect(Math.round(ratio * (moves.length - 1)) + 1)
  }

  return (
    <svg className="eval-graph" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" onClick={pick}>
      <rect width={WIDTH} height={HEIGHT} className="graph-black" />
      <path d={area} className="graph-white" />
      <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} className="graph-mid" />
      {currentPly > 0 && <line x1={currentX} y1={0} x2={currentX} y2={HEIGHT} className="graph-cursor" />}
      {marked.map(({ x, y, move }) => (
        <circle
          key={move.ply}
          cx={x}
          cy={y}
          r={4}
          fill={CLASSIFICATION_META[move.classification].color}
          stroke="#1c1b19"
          strokeWidth={1.5}
        >
          <title>{`${move.moveNumber}${move.color === 'white' ? '.' : '...'} ${move.san} — ${CLASSIFICATION_META[move.classification].label}`}</title>
        </circle>
      ))}
    </svg>
  )
}
