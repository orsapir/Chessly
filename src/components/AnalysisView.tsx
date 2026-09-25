import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { parseGame, settingsFor, settingsKey, toSan } from '../lib/analyze'
import { CLASSIFICATION_META, formatScore } from '../lib/evaluate'
import type { Color, GameReport, Score } from '../lib/types'
import { useAnalysis } from '../lib/useAnalysis'
import { Board } from './Board'
import { Spinner } from './Spinner'
import { DepthControl } from './DepthControl'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import { ExplorePanel, type ExploreLine } from './ExplorePanel'
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
  exhaustive: boolean
  onExhaustiveChange: (exhaustive: boolean) => void
  onBack: () => void
}

const START_SCORE: Score = { cp: 20, mate: null }

/** Fast enough to follow a game, slow enough to read each move. */
const PLAY_INTERVAL = 900

/** Trying moves out has to answer between clicks, whatever the report ran at. */
const EXPLORE_DEPTH = 18

interface Exploration {
  /** Position after the move being tried. */
  fen: string
  /** Position it was played from. */
  from: string
  yours: ExploreLine
  game: ExploreLine | null
  best: ExploreLine | null
}

export function AnalysisView({
  game,
  depth,
  onDepthChange,
  exhaustive,
  onExhaustiveChange,
  onBack,
}: Props) {
  const settings = useMemo(() => settingsFor(depth, exhaustive), [depth, exhaustive])
  const parsed = useMemo(() => parseGame(game.pgn), [game.pgn])
  const { report, running, progress, liveScores, error, fromCache, run, cancel, analysePosition } =
    useAnalysis()

  const [ply, setPly] = useState(0)
  const [flipped, setFlipped] = useState(
    game.hero ? game.black.username.toLowerCase() === game.hero.toLowerCase() : false,
  )
  const [tab, setTab] = useState<'report' | 'moves'>('moves')
  const [playing, setPlaying] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [explore, setExplore] = useState<Exploration | null>(null)
  const exploreRun = useRef(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  /** A swipe is followed by a click; without this it would also pick up a piece. */
  const swipedAt = useRef(0)

  // Remounted per game (App keys on game id), so the ply resets on its own.
  useEffect(() => {
    void run(game.id, game.pgn, settings)
    // settingsKey keeps this from re-running on an equivalent settings object.
  }, [game.id, game.pgn, settingsKey(settings), run]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = parsed.moves.length
  const go = useCallback((next: number) => setPly(Math.max(0, Math.min(total, next))), [total])

  // Play through the game. Reaching the last move simply stops the clock -
  // there is nothing left to schedule - and any manual move takes over, since
  // nothing is more annoying than a board that fights back.
  const autoPlaying = playing && ply < total
  useEffect(() => {
    if (!autoPlaying) return
    const timer = setTimeout(() => setPly((current) => Math.min(total, current + 1)), PLAY_INTERVAL)
    return () => clearTimeout(timer)
  }, [autoPlaying, ply, total])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const step = (next: number) => {
        setPlaying(false)
        go(next)
      }
      const actions: Record<string, () => void> = {
        ArrowLeft: () => step(ply - 1),
        ArrowRight: () => step(ply + 1),
        ArrowUp: () => step(0),
        ArrowDown: () => step(total),
        Home: () => step(0),
        End: () => step(total),
        f: () => setFlipped((value) => !value),
        ' ': () => {
          if (autoPlaying) return setPlaying(false)
          if (ply >= total) go(0)
          setPlaying(true)
        },
      }
      const action = actions[event.key]
      if (action) {
        event.preventDefault()
        action()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [autoPlaying, go, ply, total])

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
    swipedAt.current = Date.now()
    jump(dx < 0 ? ply + 1 : ply - 1)
  }

  /** Moving by hand takes the board back from the auto-play, and from exploring. */
  const jump = useCallback(
    (next: number) => {
      setPlaying(false)
      exploreRun.current++
      setExplore(null)
      setPicked(null)
      go(next)
    },
    [go],
  )

  const currentMove = ply > 0 ? parsed.moves[ply - 1] : null
  const gameFen = ply === 0 ? parsed.positions[0] : parsed.positions[ply]
  const fen = explore?.fen ?? gameFen

  // Deep settings are far too slow to wait for between clicks.
  const exploreDepth = Math.min(settings.depth, EXPLORE_DEPTH)

  const legalMoves = useMemo(() => new Chess(fen).moves({ verbose: true }), [fen])
  const targets = useMemo<string[]>(
    () => (picked ? legalMoves.filter((move) => move.from === picked).map((move) => move.to) : []),
    [legalMoves, picked],
  )

  /** Leaves exploration and puts the game's own position back on the board. */
  const backToGame = useCallback(() => {
    exploreRun.current++
    setExplore(null)
    setPicked(null)
  }, [])

  const tryMove = useCallback(
    async (from: string, to: string) => {
      const board = new Chess(fen)
      const candidate = legalMoves.find((move) => move.from === from && move.to === to)
      if (!candidate) return
      const move = board.move({ from, to, promotion: 'q' })
      if (!move) return

      const id = ++exploreRun.current
      setPicked(null)
      setExplore({ fen: move.after, from: fen, yours: { san: move.san, score: null }, game: null, best: null })

      // The game's own continuation from this position, when there is one and
      // we have not wandered off the game's path.
      const gameMove = fen === gameFen && ply < total ? parsed.moves[ply] : null

      const [afterYours, fromHere, afterGame] = await Promise.all([
        analysePosition(move.after, exploreDepth),
        analysePosition(fen, exploreDepth),
        gameMove ? analysePosition(gameMove.fenAfter, exploreDepth) : Promise.resolve(null),
      ])
      if (exploreRun.current !== id) return

      const bestUci = fromHere.lines[0]?.pv[0] ?? null
      setExplore({
        fen: move.after,
        from: fen,
        yours: { san: move.san, score: afterYours.lines[0]?.score ?? null },
        game: gameMove && afterGame ? { san: gameMove.san, score: afterGame.lines[0]?.score ?? null } : null,
        best: bestUci
          ? { san: toSan(fen, bestUci) ?? bestUci, score: fromHere.lines[0]?.score ?? null }
          : null,
      })
    },
    [analysePosition, exploreDepth, fen, gameFen, legalMoves, parsed.moves, ply, total],
  )

  const onSquare = useCallback(
    (square: string) => {
      // The click the browser sends after a swipe is not a move.
      if (Date.now() - swipedAt.current < 400) return
      setPlaying(false)
      if (picked && targets.includes(square)) {
        void tryMove(picked, square)
        return
      }
      setPicked(legalMoves.some((move) => move.from === square) ? square : null)
    },
    [legalMoves, picked, targets, tryMove],
  )
  const analyzed = report?.moves[ply - 1] ?? null
  const orientation: Color = flipped ? 'black' : 'white'
  // Whoever's pieces start at the far edge sits above the board.
  const topColor: Color = flipped ? 'white' : 'black'
  const bottomColor: Color = flipped ? 'black' : 'white'

  // Prefer a score the engine has actually returned for this position. While
  // the game is still being searched that is the live scan result; afterwards
  // it is the move's own evaluation.
  const score: Score =
    liveScores[ply] ??
    analyzed?.score ??
    (ply === 0 ? report?.moves[0]?.bestScore : undefined) ??
    START_SCORE

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
        <span className="result">{scoreline(parsed.result)}</span>
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
          <PlayerStrip
            name={topColor === 'white' ? game.white.username : game.black.username}
            rating={topColor === 'white' ? game.white.rating : game.black.rating}
            color={topColor}
            accuracy={report?.[topColor].accuracy}
          />

          <div className="board-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <EvalBar
              score={score}
              orientation={orientation}
              provisional={running || report?.preliminary === true}
            />
            <Board
              fen={fen}
              orientation={orientation}
              lastMove={
                explore
                  ? null
                  : currentMove
                    ? { from: currentMove.uci.slice(0, 2), to: currentMove.uci.slice(2, 4) }
                    : null
              }
              suggestion={explore ? null : suggestion}
              badge={explore ? null : (analyzed?.classification ?? null)}
              selected={picked}
              targets={targets}
              onSquareClick={onSquare}
            />
          </div>

          <PlayerStrip
            name={bottomColor === 'white' ? game.white.username : game.black.username}
            rating={bottomColor === 'white' ? game.white.rating : game.black.rating}
            color={bottomColor}
            accuracy={report?.[bottomColor].accuracy}
          />

          <div className="controls">
            <button onClick={() => jump(0)} title="Start (↑)" aria-label="Go to start">
              ⏮
            </button>
            <button onClick={() => jump(ply - 1)} title="Previous (←)" aria-label="Previous move">
              ◀
            </button>
            <button
              className={`play${autoPlaying ? ' active' : ''}`}
              onClick={() => {
                if (autoPlaying) return setPlaying(false)
                if (ply >= total) go(0)
                setPlaying(true)
              }}
              title={autoPlaying ? 'Pause (space)' : 'Play through the game (space)'}
              aria-label={autoPlaying ? 'Pause' : 'Play through the game'}
            >
              {autoPlaying ? '❚❚' : '▶'}
            </button>
            <span className="ply-counter">
              {ply}/{total}
            </span>
            <button onClick={() => jump(ply + 1)} title="Next (→)" aria-label="Next move">
              ▶❙
            </button>
            <button onClick={() => jump(total)} title="End (↓)" aria-label="Go to end">
              ⏭
            </button>
            <button
              onClick={() => setFlipped((value) => !value)}
              title="Flip board (f)"
              aria-label="Flip board"
            >
              ⇅
            </button>
          </div>

          {explore ? (
            <ExplorePanel
              yours={explore.yours}
              game={explore.game}
              best={explore.best}
              depth={exploreDepth}
              thinking={explore.yours.score === null}
              onBack={backToGame}
            />
          ) : running ? (
            <AnalysisProgress progress={progress} settings={settings} onStop={cancel} />
          ) : (
            <MoveComment move={analyzed} opening={report?.opening ?? null} ply={ply} />
          )}
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

          <DepthControl
            depth={depth}
            onChange={onDepthChange}
            exhaustive={exhaustive}
            onExhaustiveChange={onExhaustiveChange}
            disabled={running}
          />

          {error && <p className="error">{error}</p>}

          {report && (
            <>
              <EvalGraph moves={report.moves} currentPly={ply} onSelect={jump} />
              {tab === 'report' ? (
                <ReportPanel
                  report={report}
                  whiteName={game.white.username}
                  blackName={game.black.username}
                  onSelect={jump}
                />
              ) : (
                <MoveList moves={report.moves} currentPly={ply} onSelect={jump} />
              )}
              {fromCache && (
                <button className="ghost small rerun" onClick={() => void run(game.id, game.pgn, settings, true)}>
                  Re-analyse from scratch
                </button>
              )}
            </>
          )}

          {!report && !running && !error && (
            <MoveListFallback moves={parsed.moves} currentPly={ply} onSelect={jump} />
          )}
        </aside>
      </div>
    </div>
  )
}

function AnalysisProgress({
  progress,
  settings,
  onStop,
}: {
  progress: { done: number; total: number; phase: 'scan' | 'deep' }
  settings: { depth: number; scanDepth: number }
  onStop: () => void
}) {
  const share = progress.total ? (progress.done / progress.total) * 100 : 0
  const scanning = progress.phase === 'scan'

  return (
    <div className="comment analysing" aria-live="polite">
      <div className="analysing-head">
        <Spinner />
        <strong>{scanning ? 'Scanning every move' : 'Taking a closer look'}</strong>
        <button className="ghost small" onClick={onStop}>
          Stop
        </button>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${share}%` }} />
      </div>
      <span className="analysing-count">
        {progress.total > 1
          ? `${progress.done} of ${progress.total} positions`
          : 'Starting the engine'}{' '}
        · depth {scanning ? settings.scanDepth : settings.depth}
      </span>
    </div>
  )
}

/** The row above and below the board carrying whose move it is and how they did. */
function PlayerStrip({
  name,
  rating,
  color,
  accuracy,
}: {
  name: string
  rating?: number
  color: Color
  accuracy?: number
}) {
  return (
    <div className="player-strip">
      <span className={`piece-dot ${color}`} />
      <span className="player-name">{name}</span>
      {rating ? <span className="rating">{rating}</span> : null}
      {accuracy !== undefined && (
        <span className="player-accuracy" title="Accuracy for this game">
          {accuracy.toFixed(1)}
        </span>
      )}
    </div>
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
  opening,
  ply,
}: {
  move: GameReport['moves'][number] | null
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
        <strong>Not analysed yet</strong>
        <span />
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
