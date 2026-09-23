import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseGame, settingsFor, settingsKey } from '../lib/analyze'
import { CLASSIFICATION_META, formatScore } from '../lib/evaluate'
import type { GameReport, Score } from '../lib/types'
import { useAnalysis } from '../lib/useAnalysis'
import { Board } from './Board'
import { DepthControl } from './DepthControl'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import { MoveList } from './MoveList'
import { ReportPanel } from './ReportPanel'

export interface GameMeta {
  id: string
  pgn: string
  white: { username: string; rating?: number }
  black: { username: string; rating?: number }
  url?: string
  timeClass?: string
  endTime?: number
  /** Whose game this is, so the board starts the right way up. */
  hero?: string
}

interface Props {
  game: GameMeta
  depth: number
  onDepthChange: (depth: number) => void
  onBack: () => void
}

const START_SCORE: Score = { cp: 20, mate: null }

export function AnalysisView({ game, depth, onDepthChange, onBack }: Props) {
  const settings = useMemo(() => settingsFor(depth), [depth])
  const parsed = useMemo(() => parseGame(game.pgn), [game.pgn])
  const { report, running, progress, error, fromCache, run, cancel } = useAnalysis()

  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(
    game.hero ? game.black.username.toLowerCase() === game.hero.toLowerCase() : false,
  )
  const [tab, setTab] = useState<'report' | 'moves'>('report')
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  // Remounted per game (App keys on game id), so the ply resets on its own.
  useEffect(() => {
    void run(game.id, game.pgn, settings)
    // settingsKey keeps this from re-running on an equivalent settings object.
  }, [game.id, game.pgn, settingsKey(settings), run]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = parsed.moves.length
  const go = useCallback((next: number) => setPly(Math.max(0, Math.min(total, next))), [total])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const actions: Record<string, () => void> = {
        ArrowLeft: () => go(ply - 1),
        ArrowRight: () => go(ply + 1),
        ArrowUp: () => go(0),
        ArrowDown: () => go(total),
        Home: () => go(0),
        End: () => go(total),
        f: () => setFlipped((value) => !value),
      }
      const action = actions[event.key]
      if (action) {
        event.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, ply, total])

  // Phones have no arrow keys: swipe across the board to step through the game.
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
  }

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    go(dx < 0 ? ply + 1 : ply - 1)
  }

  const currentMove = ply > 0 ? parsed.moves[ply - 1] : null
  const fen = ply === 0 ? parsed.positions[0] : parsed.positions[ply]
  const analyzed = report?.moves[ply - 1] ?? null
  const orientation = flipped ? 'black' : 'white'

  const score: Score = analyzed
    ? analyzed.score
    : report && ply === 0
      ? report.moves[0]?.bestScore ?? START_SCORE
      : START_SCORE

  // Only nag with an arrow when the move actually cost something.
  const suggestion =
    analyzed && analyzed.bestMoveUci && analyzed.bestMoveUci !== analyzed.uci && analyzed.loss >= 5
      ? { from: analyzed.bestMoveUci.slice(0, 2), to: analyzed.bestMoveUci.slice(2, 4) }
      : null

  return (
    <div className="analysis">
      <header className="analysis-header">
        <button className="ghost" onClick={onBack}>
          ← Games
        </button>
        <div className="matchup">
          <PlayerTag name={game.white.username} rating={game.white.rating} color="white" />
          <span className="result">{scoreline(parsed.result)}</span>
          <PlayerTag name={game.black.username} rating={game.black.rating} color="black" />
        </div>
        <div className="header-side">
          {game.timeClass && <span className="chip">{game.timeClass}</span>}
          {game.url && (
            <a className="chip link" href={game.url} target="_blank" rel="noreferrer">
              chess.com ↗
            </a>
          )}
        </div>
      </header>

      <div className="analysis-body">
        <div className="board-column">
          <div className="board-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <EvalBar score={score} orientation={orientation} />
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={currentMove ? { from: currentMove.uci.slice(0, 2), to: currentMove.uci.slice(2, 4) } : null}
              suggestion={suggestion}
              badge={analyzed?.classification ?? null}
            />
          </div>

          <div className="controls">
            <button onClick={() => go(0)} title="Start (↑)">
              ⏮
            </button>
            <button onClick={() => go(ply - 1)} title="Previous (←)">
              ◀
            </button>
            <span className="ply-counter">
              {ply}/{total}
            </span>
            <button onClick={() => go(ply + 1)} title="Next (→)">
              ▶
            </button>
            <button onClick={() => go(total)} title="End (↓)">
              ⏭
            </button>
            <button onClick={() => setFlipped((value) => !value)} title="Flip board (f)">
              ⇅
            </button>
          </div>

          <MoveComment
            move={analyzed}
            running={running}
            opening={report?.opening ?? null}
            ply={ply}
          />
        </div>

        <aside className="side-column">
          <div className="side-top">
            <div className="tabs">
              <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>
                Report
              </button>
              <button className={tab === 'moves' ? 'active' : ''} onClick={() => setTab('moves')}>
                Moves
              </button>
            </div>
          </div>

          <DepthControl depth={depth} onChange={onDepthChange} disabled={running} />

          {running && (
            <div className="progress">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <div className="progress-row">
                <span>
                  {progress.phase === 'scan' ? 'Scanning' : 'Taking a closer look at'}{' '}
                  {progress.done}/{progress.total} positions
                </span>
                <button className="ghost small" onClick={cancel}>
                  Stop
                </button>
              </div>
            </div>
          )}

          {error && <p className="error">{error}</p>}

          {report && (
            <>
              <EvalGraph moves={report.moves} currentPly={ply} onSelect={go} />
              {tab === 'report' ? (
                <ReportPanel
                  report={report}
                  whiteName={game.white.username}
                  blackName={game.black.username}
                  onSelect={go}
                />
              ) : (
                <MoveList moves={report.moves} currentPly={ply} onSelect={go} />
              )}
              {fromCache && (
                <button className="ghost small rerun" onClick={() => void run(game.id, game.pgn, settings, true)}>
                  Re-analyse from scratch
                </button>
              )}
            </>
          )}

          {!report && !running && !error && <MoveListFallback moves={parsed.moves} currentPly={ply} onSelect={go} />}
        </aside>
      </div>
    </div>
  )
}

function PlayerTag({ name, rating, color }: { name: string; rating?: number; color: 'white' | 'black' }) {
  return (
    <span className="player-tag">
      <span className={`dot ${color}`} />
      {name}
      {rating ? <span className="rating">{rating}</span> : null}
    </span>
  )
}

function scoreline(result: string): string {
  if (result === '1-0') return '1 – 0'
  if (result === '0-1') return '0 – 1'
  if (result === '1/2-1/2') return '½ – ½'
  return result
}

function MoveComment({
  move,
  running,
  opening,
  ply,
}: {
  move: GameReport['moves'][number] | null
  running: boolean
  opening: string | null
  ply: number
}) {
  if (ply === 0) {
    return (
      <div className="comment neutral">
        <strong>{opening ?? 'Starting position'}</strong>
        <span>Use ← and → to step through the game.</span>
      </div>
    )
  }
  if (!move) {
    return (
      <div className="comment neutral">
        <strong>{running ? 'Still thinking…' : 'Not analysed yet'}</strong>
        <span>{running ? 'Annotations appear as soon as the engine finishes.' : ''}</span>
      </div>
    )
  }

  const meta = CLASSIFICATION_META[move.classification]
  const alternative =
    move.bestMoveSan && move.bestMoveSan !== move.san && move.loss >= 2
      ? `Best was ${move.bestMoveSan}.`
      : move.bestLineSan.length > 1
        ? `Then ${move.bestLineSan.slice(1, 4).join(' ')}`
        : ''

  return (
    <div className="comment" style={{ borderColor: meta.color }}>
      <strong style={{ color: meta.color }}>
        {move.moveNumber}
        {move.color === 'white' ? '.' : '…'} {move.san} — {meta.label}
      </strong>
      <span>
        {move.classification === 'book' && move.opening
          ? move.opening
          : `${meta.blurb} ${alternative}`.trim()}
      </span>
      <span className="comment-eval">
        {formatScore(move.score)}
        {move.loss >= 1 ? ` · −${move.loss.toFixed(0)}% win chance` : ''}
        {move.sacrifice && move.classification === 'brilliant'
          ? ` · sacrifices ${(move.sacrifice / 100).toFixed(1)} pawns of material`
          : ''}
      </span>
    </div>
  )
}

function MoveListFallback({
  moves,
  currentPly,
  onSelect,
}: {
  moves: ReturnType<typeof parseGame>['moves']
  currentPly: number
  onSelect: (ply: number) => void
}) {
  return (
    <div className="move-list plain">
      {moves.map((move, index) => (
        <button
          key={index}
          className={`move-cell${currentPly === index + 1 ? ' active' : ''}`}
          onClick={() => onSelect(index + 1)}
        >
          {index % 2 === 0 ? `${index / 2 + 1}. ` : ''}
          {move.san}
        </button>
      ))}
    </div>
  )
}
