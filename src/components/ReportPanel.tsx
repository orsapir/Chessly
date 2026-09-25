import { CLASSIFICATION_META, CLASSIFICATION_ORDER } from '../lib/evaluate'
import type { AnalyzedMove, Classification, GameReport } from '../lib/types'

interface Props {
  report: GameReport
  whiteName: string
  blackName: string
  onSelect: (ply: number) => void
}

/** Classifications worth a row in the summary, in the order players read them. */
const SHOWN: Classification[] = CLASSIFICATION_ORDER.filter((key) => key !== 'forced')

export function ReportPanel({ report, whiteName, blackName, onSelect }: Props) {
  const turning = report.turningPoints
    .map((ply) => report.moves[ply])
    .filter((move): move is AnalyzedMove => Boolean(move))

  return (
    <div className="report">
      <div className="accuracy-row">
        {(['white', 'black'] as const).map((color) => {
          const player = report[color]
          return (
            <div className={`accuracy-card ${color}`} key={color}>
              <span className="accuracy-name">{color === 'white' ? whiteName : blackName}</span>
              <span className="accuracy-value">{player.accuracy.toFixed(1)}</span>
              <span className="accuracy-caption">accuracy</span>
              <dl className="player-stats">
                <div>
                  <dt>Est. rating</dt>
                  <dd
                    title={
                      player.estimatedRating
                        ? `Implied by how this game was played, from ${player.decidedMoves} real decisions`
                        : 'Too few decisions in this game to put a number on it'
                    }
                  >
                    {player.estimatedRating ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt>Avg. loss</dt>
                  <dd title="Average centipawn loss per decision">{player.acpl}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>

      <table className="counts">
        <tbody>
          {SHOWN.map((key) => {
            const white = report.white.counts[key]
            const black = report.black.counts[key]
            if (!white && !black) return null
            const meta = CLASSIFICATION_META[key]
            return (
              <tr key={key}>
                <td className="count-value">{white}</td>
                <td className="count-label">
                  <span className="count-glyph" style={{ color: meta.color }}>
                    {meta.glyph}
                  </span>
                  {meta.label}
                </td>
                <td className="count-value">{black}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {(report.white.estimatedRating === null || report.black.estimatedRating === null) && (
        <p className="muted small no-turning">
          A rating needs more of a game to stand on: this one had too few moves that were a real
          decision rather than opening theory or a forced reply.
        </p>
      )}

      {turning.length === 0 && (
        <p className="muted small no-turning">
          No move cost more than a tenth of the game — this one was decided in small increments.
        </p>
      )}

      {turning.length > 0 && (
        <div className="turning-points">
          <h3>Where it turned</h3>
          {turning.map((move) => {
            const meta = CLASSIFICATION_META[move.classification]
            return (
              <button key={move.ply} className="turning-point" onClick={() => onSelect(move.ply + 1)}>
                <span className="turning-glyph" style={{ background: meta.color }}>
                  {meta.glyph}
                </span>
                <span>
                  <strong>
                    {move.moveNumber}
                    {move.color === 'white' ? '.' : '…'} {move.san}
                  </strong>{' '}
                  gave up {move.loss.toFixed(0)}% of the game
                  {move.bestMoveSan && move.bestMoveSan !== move.san ? ` — ${move.bestMoveSan} held it` : ''}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <p className="report-footnote">
        {report.engine}{' '}
        {report.settings.scanDepth < report.settings.depth
          ? `— theory skimmed, every move after it to depth ${report.settings.scanDepth}, key moments to depth ${report.settings.depth}`
          : `at depth ${report.settings.depth}`}
        . Accuracy ignores book and forced moves.
      </p>
    </div>
  )
}
