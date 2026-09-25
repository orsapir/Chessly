import { formatScore } from '../lib/evaluate'
import type { Score } from '../lib/types'

export interface ExploreLine {
  /** What was played, in the notation a player reads. */
  san: string
  score: Score | null
}

interface Props {
  /** The move the player tried out. */
  yours: ExploreLine
  /** What actually happened in the game from the same position, if it was not the last move. */
  game: ExploreLine | null
  /** The engine's own choice from that position. */
  best: ExploreLine | null
  depth: number
  thinking: boolean
  onBack: () => void
}

/**
 * Side by side, all three at the same depth - comparing a fresh search against
 * a number from the game report would be comparing two different searches.
 */
export function ExplorePanel({ yours, game, best, depth, thinking, onBack }: Props) {
  const rows: { label: string; line: ExploreLine; highlight?: boolean }[] = [
    { label: 'Your move', line: yours, highlight: true },
  ]
  if (game) rows.push({ label: 'The game', line: game })
  if (best && best.san !== yours.san && best.san !== game?.san) {
    rows.push({ label: 'Engine prefers', line: best })
  }

  return (
    <div className="comment exploring">
      <div className="exploring-head">
        <strong>Trying a move</strong>
        <button className="ghost small" onClick={onBack}>
          Back to the game
        </button>
      </div>

      <table className="exploring-lines">
        <tbody>
          {rows.map(({ label, line, highlight }) => (
            <tr key={label} className={highlight ? 'yours' : undefined}>
              <td className="exploring-label">{label}</td>
              <td className="exploring-san">{line.san}</td>
              <td className="exploring-score">
                {line.score ? formatScore(line.score) : thinking ? '…' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <span className="exploring-note">
        {thinking ? `Thinking at depth ${depth}…` : `All three at depth ${depth}, from White's side.`}
      </span>
    </div>
  )
}
