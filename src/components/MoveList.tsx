import { useEffect, useRef } from 'react'
import { CLASSIFICATION_META, formatScore } from '../lib/evaluate'
import { ClassBadge } from './ClassBadge'
import type { AnalyzedMove } from '../lib/types'

interface Props {
  moves: AnalyzedMove[]
  currentPly: number
  onSelect: (ply: number) => void
}

export function MoveList({ moves, currentPly, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentPly])

  const rows: { number: number; white?: AnalyzedMove; black?: AnalyzedMove }[] = []
  for (const move of moves) {
    const last = rows[rows.length - 1]
    if (move.color === 'white' || !last || last.black || last.number !== move.moveNumber) {
      rows.push({ number: move.moveNumber, [move.color]: move })
    } else {
      last.black = move
    }
  }

  return (
    <div className="move-list">
      {rows.map((row) => (
        <div className="move-row" key={row.number}>
          <span className="move-number">{row.number}.</span>
          {(['white', 'black'] as const).map((color) => {
            const move = row[color]
            if (!move) return <span key={color} className="move-cell" />
            const meta = CLASSIFICATION_META[move.classification]
            const active = currentPly === move.ply + 1
            return (
              <button
                key={color}
                ref={active ? activeRef : undefined}
                className={`move-cell${active ? ' active' : ''}`}
                onClick={() => onSelect(move.ply + 1)}
                title={`${meta.label} · ${formatScore(move.score)}`}
              >
                <span className="move-san">{move.san}</span>
                <ClassBadge classification={move.classification} size={16} />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
