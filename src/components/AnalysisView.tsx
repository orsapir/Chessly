import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { lineToSan, parseGame, settingsFor, settingsKey } from '../lib/analyze'
import { capturedMaterial } from '../lib/material'
import { CLASSIFICATION_META, formatScore } from '../lib/evaluate'
import type { Color, GameReport, Score } from '../lib/types'
import { useAnalysis } from '../lib/useAnalysis'
import { useMediaQuery } from '../lib/useMediaQuery'
import { Board } from './Board'
import { ClassBadge } from './ClassBadge'
import { Icon } from './Icon'
import { Spinner } from './Spinner'
import { DepthControl } from './DepthControl'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import { EngineLines, type EngineLineView } from './EngineLines'
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

/** How many lines the engine offers for the position on the board. */
const ENGINE_LINES = 3

/** A settled position gets a moment before the engine is sent after it. */
const ENGINE_DEBOUNCE = 220

/** Moves played by hand from some point in the game: the "what if" line. */
interface Variation {
  /** The ply of the game it left from, so it can be put back. */
  fromPly: number
  moves: { san: string; uci: string; fen: string }[]
}

export function AnalysisView({
  game,
  depth,
  onDepthChange,
  exhaustive,
  onExhaustiveChange,
  onBack,
}: Props) {
  const compact = useMediaQuery('(max-width: 600px)')
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
  const [variation, setVariation] = useState<Variation | null>(null)
  const [engine, setEngine] = useState<{ fen: string; ply: number; lines: EngineLineView[] } | null>(null)

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

  /** Takes back the last move of the line, and the line itself with the first. */
  const takeBack = useCallback(() => {
    setPicked(null)
    setVariation((current) =>
      current && current.moves.length > 1 ? { ...current, moves: current.moves.slice(0, -1) } : null,
    )
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const step = (next: number) => {
        setPlaying(false)
        go(next)
      }
      const actions: Record<string, () => void> = {
        // In a line of your own, back means take the move back rather than
        // walking the game out from under it.
        ArrowLeft: () => (variation ? takeBack() : step(ply - 1)),
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
  }, [autoPlaying, go, ply, takeBack, total, variation])

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

  /** Moving through the game takes the board back from auto-play and from a line. */
  const jump = useCallback(
    (next: number) => {
      setPlaying(false)
      setVariation(null)
      setPicked(null)
      go(next)
    },
    [go],
  )

  const currentMove = ply > 0 ? parsed.moves[ply - 1] : null
  const gameFen = ply === 0 ? parsed.positions[0] : parsed.positions[ply]
  const fen = variation?.moves[variation.moves.length - 1]?.fen ?? gameFen
  /** How far into the game the position on the board is, counting a line's moves. */
  const boardPly = ply + (variation?.moves.length ?? 0)

  // Deep settings are far too slow to wait for between clicks.
  const exploreDepth = Math.min(settings.depth, EXPLORE_DEPTH)

  const legalMoves = useMemo(() => new Chess(fen).moves({ verbose: true }), [fen])
  const targets = useMemo<string[]>(
    () => (picked ? legalMoves.filter((move) => move.from === picked).map((move) => move.to) : []),
    [legalMoves, picked],
  )

  /** Puts the game's own position back on the board. */
  const backToGame = useCallback(() => {
    setVariation(null)
    setPicked(null)
  }, [])

  /**
   * Plays a move on the board and keeps going from there. Off the game's path
   * this is a line of your own, as long as you like - the game is always one
   * button away.
   */
  const playMove = useCallback(
    (from: string, to: string) => {
      const board = new Chess(fen)
      let move
      try {
        move = board.move({ from, to, promotion: 'q' })
      } catch {
        return
      }
      if (!move) return
      setPlaying(false)
      setPicked(null)
      setVariation((current) => ({
        fromPly: current?.fromPly ?? ply,
        moves: [
          ...(current?.moves ?? []),
          { san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ''}`, fen: move.after },
        ],
      }))
    },
    [fen, ply],
  )

  /** Playing a move the engine suggested, by name rather than by square. */
  const playSan = useCallback(
    (san: string) => {
      const candidate = legalMoves.find((move) => move.san === san)
      if (candidate) playMove(candidate.from, candidate.to)
    },
    [legalMoves, playMove],
  )

  // The engine's own opinion of whatever is on the board, refreshed as it
  // changes. It waits for the report to finish rather than fighting it for
  // the same engines, and a settled position gets a moment first so stepping
  // through the game does not queue a search per move.
  useEffect(() => {
    if (running) return
    let cancelled = false
    const timer = setTimeout(async () => {
      let result
      try {
        result = await analysePosition(fen, exploreDepth, ENGINE_LINES)
      } catch {
        return
      }
      if (cancelled) return
      setEngine({
        fen,
        ply: boardPly,
        lines: result.lines
          .filter((line) => line.pv.length > 0)
          .map((line) => ({ score: line.score, san: lineToSan(fen, line.pv, 6) })),
      })
    }, ENGINE_DEBOUNCE)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [analysePosition, boardPly, exploreDepth, fen, running])

  const onSquare = useCallback(
    (square: string) => {
      // The click the browser sends after a swipe is not a move.
      if (Date.now() - swipedAt.current < 400) return
      setPlaying(false)
      if (picked && targets.includes(square)) {
        playMove(picked, square)
        return
      }
      setPicked(legalMoves.some((move) => move.from === square) ? square : null)
    },
    [legalMoves, picked, playMove, targets],
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
    (variation && engine?.fen === fen ? engine.lines[0]?.score : null) ??
    liveScores[ply] ??
    analyzed?.score ??
    (ply === 0 ? report?.moves[0]?.bestScore : undefined) ??
    START_SCORE

  // Whichever move led to the position on the board: the game's, or the last
  // one played by hand.
  const shown = variation?.moves[variation.moves.length - 1]?.uci ?? currentMove?.uci ?? null
  const lastMove = shown ? { from: shown.slice(0, 2), to: shown.slice(2, 4) } : null

  // Only nag with an arrow when the move actually cost something.
  const suggestion =
    analyzed && analyzed.bestMoveUci && analyzed.bestMoveUci !== analyzed.uci && analyzed.loss >= 5
      ? { from: analyzed.bestMoveUci.slice(0, 2), to: analyzed.bestMoveUci.slice(2, 4) }
      : null

  // A phone wants the review in a different order, and the move list along the
  // bottom rather than down the side, so the pieces are built once and placed
  // twice rather than styled into a different shape.
  const verdict = variation ? (
    <VariationBar
      variation={variation}
      gameMove={variation.fromPly < total ? parsed.moves[variation.fromPly].san : null}
      onTakeBack={takeBack}
      onBack={backToGame}
    />
  ) : running ? (
    <AnalysisProgress progress={progress} settings={settings} onStop={cancel} />
  ) : (
    <MoveComment move={analyzed} opening={report?.opening ?? null} ply={ply} />
  )

  const engineBlock = (
    <EngineLines
      lines={engine?.lines ?? []}
      depth={exploreDepth}
      ply={engine?.ply ?? boardPly}
      stale={engine?.fen !== fen}
      busy={running}
      onPlay={playSan}
    />
  )

  const moveList = report ? (
    <MoveList moves={report.moves} currentPly={ply} onSelect={jump} strip={compact} />
  ) : (
    <MoveListFallback moves={parsed.moves} currentPly={ply} onSelect={jump} />
  )

  const controls = (
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
  )

  const settingsBlock = showSettings && (
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
  )

  const reviewHead = (
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
  )

  const summary = report && (
    <>
      <EvalGraph moves={report.moves} currentPly={ply} onSelect={jump} />
      <ReportSummary report={report} whiteName={game.white.username} blackName={game.black.username} />
    </>
  )

  const board = (
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
          lastMove={lastMove}
          suggestion={variation ? null : suggestion}
          badge={variation ? null : (analyzed?.classification ?? null)}
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

      {engineBlock}
    </div>
  )

  const header = (
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
  )

  // The phone: board, what the engine makes of it, then the moves and the
  // controls pinned to the bottom of the screen where a thumb is. The report
  // itself sits below, for anyone who scrolls to it.
  if (compact) {
    return (
      <div className="analysis phone">
        {header}
        {board}
        {verdict}
        <div className="phone-bar">
          {moveList}
          {controls}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="review-panel">
          {reviewHead}
          {settingsBlock}
          {summary}
          <div className="review-scroll">
            {report && <ReportDetail report={report} onSelect={jump} />}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="analysis">
      {header}

      <div className="analysis-body">
        {board}

        <aside className="review-panel">
          {reviewHead}
          {settingsBlock}
          {error && <p className="error">{error}</p>}
          {summary}

          <div className="review-scroll">
            {moveList}
            {report && <ReportDetail report={report} onSelect={jump} />}
          </div>

          <div className="review-foot">
            {verdict}
            {controls}
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

/**
 * The line you have played by hand, and the way back. Stepping through the
 * game with the arrows leaves it too, so nothing traps you here.
 */
function VariationBar({
  variation,
  gameMove,
  onTakeBack,
  onBack,
}: {
  variation: Variation
  /** What the game played from the position the line left, if it had a move left. */
  gameMove: string | null
  onTakeBack: () => void
  onBack: () => void
}) {
  const first = variation.moves[0]?.san
  return (
    <div className="comment exploring">
      <div className="exploring-head">
        <strong>Your line</strong>
        <span className="exploring-buttons">
          <button className="ghost small" onClick={onTakeBack}>
            Take back
          </button>
          <button className="ghost small" onClick={onBack}>
            Back to the game
          </button>
        </span>
      </div>
      <span className="exploring-moves">
        {variation.moves
          .map((move, index) => {
            const at = variation.fromPly + index
            const number = Math.floor(at / 2) + 1
            const prefix = at % 2 === 0 ? `${number}. ` : index === 0 ? `${number}… ` : ''
            return `${prefix}${move.san}`
          })
          .join(' ')}
      </span>
      {gameMove && first && gameMove !== first && (
        <span className="exploring-note">In the game: {gameMove}</span>
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
