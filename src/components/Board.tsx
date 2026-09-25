import { Chess } from 'chess.js'
import { useMemo } from 'react'
import { CLASSIFICATION_META } from '../lib/evaluate'
import type { Classification, Color } from '../lib/types'
import { PIECE_SVG, type PieceKey } from './pieces'

const SQUARE = 45
const SIZE = SQUARE * 8

export interface BoardProps {
  fen: string
  orientation: Color
  lastMove?: { from: string; to: string } | null
  /** Drawn as an arrow, for "you could have played this instead". */
  suggestion?: { from: string; to: string } | null
  /** Badge pinned to the destination square of the last move. */
  badge?: Classification | null
  /** Square the player has picked up, if any. */
  selected?: string | null
  /** Where that piece may legally go. */
  targets?: string[]
  /** Called for every square; the caller decides what a click means. */
  onSquareClick?: (square: string) => void
}

const FILES = 'abcdefgh'
const SQUARE_NAMES = FILES.split('').flatMap((file) =>
  Array.from({ length: 8 }, (_, index) => `${file}${index + 1}`),
)

function squareToXY(square: string, orientation: Color): { x: number; y: number } {
  const file = FILES.indexOf(square[0])
  const rank = Number(square[1]) - 1
  return orientation === 'white'
    ? { x: file * SQUARE, y: (7 - rank) * SQUARE }
    : { x: (7 - file) * SQUARE, y: rank * SQUARE }
}

export function Board({
  fen,
  orientation,
  lastMove,
  suggestion,
  badge,
  selected,
  targets,
  onSquareClick,
}: BoardProps) {
  const { pieces, checkedKing } = useMemo(() => {
    const chess = new Chess()
    let inCheck = false
    try {
      chess.load(fen)
      inCheck = chess.isCheck()
    } catch {
      return { pieces: [], checkedKing: null as string | null }
    }
    const list: { square: string; key: PieceKey }[] = []
    let king: string | null = null
    for (const row of chess.board()) {
      for (const cell of row) {
        if (!cell) continue
        const key = `${cell.color}${cell.type.toUpperCase()}` as PieceKey
        list.push({ square: cell.square, key })
        if (cell.type === 'k' && cell.color === chess.turn() && inCheck) king = cell.square
      }
    }
    return { pieces: list, checkedKing: king }
  }, [fen])

  const squares = []
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const square = `${FILES[file]}${8 - rank}`
      const { x, y } = squareToXY(square, orientation)
      squares.push(
        <rect
          key={square}
          x={x}
          y={y}
          width={SQUARE}
          height={SQUARE}
          className={(file + rank) % 2 === 0 ? 'sq-light' : 'sq-dark'}
        />,
      )
    }
  }

  const badgeMeta = badge ? CLASSIFICATION_META[badge] : null
  const badgeAt = badge && lastMove ? squareToXY(lastMove.to, orientation) : null

  return (
    <svg className="board" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Chess position">
      <g>{squares}</g>

      {lastMove && (
        <g className="last-move">
          {[lastMove.from, lastMove.to].map((square) => {
            const { x, y } = squareToXY(square, orientation)
            return <rect key={square} x={x} y={y} width={SQUARE} height={SQUARE} />
          })}
        </g>
      )}

      {checkedKing &&
        (() => {
          const { x, y } = squareToXY(checkedKing, orientation)
          return (
            <circle
              className="check-glow"
              cx={x + SQUARE / 2}
              cy={y + SQUARE / 2}
              r={SQUARE * 0.55}
            />
          )
        })()}

      {pieces.map(({ square, key }) => {
        const { x, y } = squareToXY(square, orientation)
        return (
          <g
            key={`${square}-${key}`}
            transform={`translate(${x} ${y})`}
            dangerouslySetInnerHTML={{ __html: PIECE_SVG[key] }}
          />
        )
      })}

      <g className="coords">
        {FILES.split('').map((file, index) => {
          const x = (orientation === 'white' ? index : 7 - index) * SQUARE
          return (
            <text key={file} x={x + SQUARE - 4} y={SIZE - 4} className={index % 2 === 0 ? 'on-dark' : 'on-light'}>
              {file}
            </text>
          )
        })}
        {Array.from({ length: 8 }, (_, index) => {
          const rank = index + 1
          const y = (orientation === 'white' ? 8 - rank : rank - 1) * SQUARE
          return (
            <text key={rank} x={3} y={y + 12} className={index % 2 === 0 ? 'on-dark' : 'on-light'}>
              {rank}
            </text>
          )
        })}
      </g>

      {selected &&
        (() => {
          const { x, y } = squareToXY(selected, orientation)
          return <rect className="selected-square" x={x} y={y} width={SQUARE} height={SQUARE} />
        })()}

      {targets?.map((square) => {
        const { x, y } = squareToXY(square, orientation)
        const occupied = pieces.some((piece) => piece.square === square)
        return occupied ? (
          <circle
            key={square}
            className="target-ring"
            cx={x + SQUARE / 2}
            cy={y + SQUARE / 2}
            r={SQUARE * 0.44}
          />
        ) : (
          <circle
            key={square}
            className="target-dot"
            cx={x + SQUARE / 2}
            cy={y + SQUARE / 2}
            r={SQUARE * 0.16}
          />
        )
      })}

      {suggestion && <Arrow from={suggestion.from} to={suggestion.to} orientation={orientation} />}

      {onSquareClick && (
        <g className="click-layer">
          {SQUARE_NAMES.map((square) => {
            const { x, y } = squareToXY(square, orientation)
            return (
              <rect
                key={square}
                x={x}
                y={y}
                width={SQUARE}
                height={SQUARE}
                onClick={() => onSquareClick(square)}
              />
            )
          })}
        </g>
      )}

      {badgeMeta && badgeAt && (
        <g transform={`translate(${badgeAt.x + SQUARE - 9} ${badgeAt.y + 9})`} className="badge">
          <circle r={12} fill={badgeMeta.color} />
          <text textAnchor="middle" dominantBaseline="central" y={1}>
            {badgeMeta.glyph}
          </text>
        </g>
      )}
    </svg>
  )
}

function Arrow({ from, to, orientation }: { from: string; to: string; orientation: Color }) {
  const start = squareToXY(from, orientation)
  const end = squareToXY(to, orientation)
  const x1 = start.x + SQUARE / 2
  const y1 = start.y + SQUARE / 2
  const x2 = end.x + SQUARE / 2
  const y2 = end.y + SQUARE / 2
  const angle = Math.atan2(y2 - y1, x2 - x1)
  // Stop short of the centre so the arrowhead sits on the edge of the square.
  const inset = SQUARE * 0.36
  const tipX = x2 - Math.cos(angle) * inset
  const tipY = y2 - Math.sin(angle) * inset

  return (
    <g className="arrow">
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <line x1={x1} y1={y1} x2={tipX} y2={tipY} markerEnd="url(#arrowhead)" />
    </g>
  )
}
