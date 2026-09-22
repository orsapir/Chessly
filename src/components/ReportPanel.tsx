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
        {(['white', 'black'] as const).map((color) => (
          <div className={`accuracy-card ${color}`} key={color}>
            <span className="accuracy-name">{color === 'white' ? whiteName : blackName}</span>
            <span className="accuracy-value">{report[color].accuracy.toFixed(1)}</span>
            <span className="accuracy-caption">accuracy</span>
            <span className="accuracy-sub">
              {report[color].acpl} avg. centipawn loss
              {report[color].estimatedRating ? ` · ~${report[color].estimatedRating} level` : ''}
            </span>
          </div>
        ))}
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
        {report.engine} at depth {report.depth}. Accuracy ignores book and forced moves.
      </p>
    </div>
  )
}
