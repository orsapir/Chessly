import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { parseGame, settingsFor, settingsKey, toSan } from '../lib/analyze'
import { CLASSIFICATION_META, formatScore } from '../lib/evaluate'
import type { Color, GameReport, Score } from '../lib/types'
import { useAnalysis } from '../lib/useAnalysis'
import { Board } from './Board'
import { ClassBadge } from './ClassBadge'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { DepthControl } from './DepthControl'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import { ExplorePanel, type ExploreLine } from './ExplorePanel'
import { MoveList } from './MoveList'
import { ReportDetail, ReportSummary } from './ReportPanel'

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
  const [showSettings, setShowSettings] = useState(false)
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
  const material = useMemo(() => capturedMaterial(fen), [fen])
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
        <button className="icon-button" onClick={onBack} title="Back to the game list" aria-label="Back to games">
          <Icon name="back" />
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
            captured={material[topColor]}
            edge={material.edge[topColor]}
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
            captured={material[bottomColor]}
            edge={material.edge[bottomColor]}
          />
        </div>

        <aside className="review-panel">
          <div className="review-head">
            <Icon name="chart" size={18} />
            <strong>Game Review</strong>
            <button
              className={`icon-button${showSettings ? ' on' : ''}`}
              onClick={() => setShowSettings((value) => !value)}
              title="Analysis settings"
              aria-label="Analysis settings"
              aria-expanded={showSettings}
            >
              <Icon name="gear" size={18} />
            </button>
          </div>

          {showSettings && (
            <div className="review-settings">
              <DepthControl
                depth={depth}
                onChange={onDepthChange}
                exhaustive={exhaustive}
                onExhaustiveChange={onExhaustiveChange}
                disabled={running}
              />
              {fromCache && (
                <button className="ghost small rerun" onClick={() => void run(game.id, game.pgn, settings, true)}>
                  Re-analyse from scratch
                </button>
              )}
            </div>
          )}

          {error && <p className="error">{error}</p>}

          {report && (
            <ReportSummary
              report={report}
              whiteName={game.white.username}
              blackName={game.black.username}
            />
          )}

          <div className="review-scroll">
            {report && (
              <>
                <MoveList moves={report.moves} currentPly={ply} onSelect={jump} />
                <EvalGraph moves={report.moves} currentPly={ply} onSelect={jump} />
                <ReportDetail report={report} onSelect={jump} />
              </>
            )}
            {!report && <MoveListFallback moves={parsed.moves} currentPly={ply} onSelect={jump} />}
          </div>

          <div className="review-foot">
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

            <div className="controls">
              <button
                className="icon-button"
                onClick={() => setFlipped((value) => !value)}
                title="Flip board (f)"
                aria-label="Flip board"
              >
                <Icon name="flip" />
              </button>
              <button className="icon-button" onClick={() => jump(0)} title="Start (↑)" aria-label="Go to start">
                <Icon name="start" />
              </button>
              <button className="icon-button" onClick={() => jump(ply - 1)} title="Previous (←)" aria-label="Previous move">
                <Icon name="prev" />
              </button>
              <button
                className={`icon-button play${autoPlaying ? ' active' : ''}`}
                onClick={() => {
                  if (autoPlaying) return setPlaying(false)
                  if (ply >= total) go(0)
                  setPlaying(true)
                }}
                title={autoPlaying ? 'Pause (space)' : 'Play through the game (space)'}
                aria-label={autoPlaying ? 'Pause' : 'Play through the game'}
              >
                <Icon name={autoPlaying ? 'pause' : 'play'} />
              </button>
              <button className="icon-button" onClick={() => jump(ply + 1)} title="Next (→)" aria-label="Next move">
                <Icon name="next" />
              </button>
              <button className="icon-button" onClick={() => jump(total)} title="End (↓)" aria-label="Go to end">
                <Icon name="end" />
              </button>
              <span className="ply-counter">
                {ply}/{total}
              </span>
            </div>
          </div>
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

/** The row above and below the board: who it is, what they took, how they did. */
function PlayerStrip({
  name,
  rating,
  color,
  accuracy,
  captured,
  edge,
}: {
  name: string
  rating?: number
  color: Color
  accuracy?: number
  captured: string
  edge: number
}) {
  return (
    <div className="player-strip">
      <span className={`avatar ${color}`} aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="player-name">{name}</span>
      {rating ? <span className="rating">({rating})</span> : null}
      <span className={`captured ${color === 'white' ? 'black' : 'white'}`}>
        {captured}
        {edge > 0 ? <span className="edge">+{edge}</span> : null}
      </span>
      {accuracy !== undefined && (
        <span className="player-accuracy" title="Accuracy for this game">
          {accuracy.toFixed(1)}
        </span>
      )}
    </div>
  )
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const TAKEN_GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
/** What each side starts with, and what each of those is worth. */
const START_COUNT: [string, number][] = [
  ['q', 1],
  ['r', 2],
  ['b', 2],
  ['n', 2],
  ['p', 8],
]

export interface Material {
  /** The pieces this side has taken, as glyphs, biggest first. */
  white: string
  black: string
  /** Material lead in pawns, for the side that has one. */
  edge: Record<Color, number>
}

/**
 * What each side has taken, read off the position rather than the move list so
 * it is right wherever the board is - including a position reached by trying a
 * move out. `edge` is the material lead in pawns, which is the number a chess
 * site puts beside the pieces. A promotion can leave a side with more of a
 * piece than it started with, so what is missing never goes below zero.
 */
function capturedMaterial(fen: string): Material {
  const board = fen.split(' ')[0]
  const taken = { white: '', black: '' }
  const held = { white: 0, black: 0 }
  for (const [kind, start] of START_COUNT) {
    for (const color of ['white', 'black'] as const) {
      const letter = color === 'white' ? kind.toUpperCase() : kind
      const left = board.split(letter).length - 1
      held[color] += left * PIECE_VALUE[kind]
      // Whatever is missing from this side was taken by the other one.
      const other = color === 'white' ? 'black' : 'white'
      taken[other] += TAKEN_GLYPH[kind].repeat(Math.max(0, start - left))
    }
  }
  const lead = held.white - held.black
  return {
    white: taken.white,
    black: taken.black,
    edge: { white: Math.max(0, lead), black: Math.max(0, -lead) },
  }
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
        <span>Play through the game, or move a piece to try something else.</span>
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
      ? `Best move was ${move.bestMoveSan}.`
      : move.bestLineSan.length > 1
        ? `Then ${move.bestLineSan.slice(1, 4).join(' ')}`
        : ''

  return (
    <div className="comment verdict" style={{ borderColor: meta.color }}>
      <div className="verdict-head">
        <ClassBadge classification={move.classification} size={22} />
        <strong style={{ color: meta.color }}>
          {move.san} {meta.verdict}
        </strong>
        <span className="comment-eval">{formatScore(move.score)}</span>
      </div>
      <span>
        {move.classification === 'book' && move.opening
          ? move.opening
          : `${meta.blurb} ${alternative}`.trim()}
      </span>
      {(move.loss >= 1 || (move.sacrifice && move.classification === 'brilliant')) && (
        <span className="comment-eval">
          {move.loss >= 1 ? `−${move.loss.toFixed(0)}% win chance` : ''}
          {move.sacrifice && move.classification === 'brilliant'
            ? `${move.loss >= 1 ? ' · ' : ''}gives up ${(move.sacrifice / 100).toFixed(1)} pawns`
            : ''}
        </span>
      )}
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
