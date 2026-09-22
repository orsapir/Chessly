import { useState } from 'react'
import { parseGame, type Preset } from './lib/analyze'
import { AnalysisView, type GameMeta } from './components/AnalysisView'
import { GameBrowser } from './components/GameBrowser'
import { Home } from './components/Home'

type View =
  | { kind: 'home' }
  | { kind: 'games'; username: string }
  | { kind: 'analysis'; game: GameMeta; from: View }

const LAST_USER = 'chessly:last-user'
const LAST_PRESET = 'chessly:preset'

export default function App() {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(LAST_USER)
    return saved ? { kind: 'games', username: saved } : { kind: 'home' }
  })
  const [preset, setPreset] = useState<Preset>(
    () => (localStorage.getItem(LAST_PRESET) as Preset) ?? 'balanced',
  )

  const choosePreset = (next: Preset) => {
    setPreset(next)
    localStorage.setItem(LAST_PRESET, next)
  }

  const openUser = (username: string) => {
    localStorage.setItem(LAST_USER, username)
    setView({ kind: 'games', username })
  }

  const openPgn = (pgn: string) => {
    const { headers } = parseGame(pgn)
    setView({
      kind: 'analysis',
      from: view,
      game: {
        id: `pgn:${hash(pgn)}`,
        pgn,
        white: { username: headers.White || 'White' },
        black: { username: headers.Black || 'Black' },
        timeClass: headers.TimeControl,
      },
    })
  }

  return (
    <div className="app">
      <nav className="topbar">
        <button
          className="brand"
          onClick={() => setView({ kind: 'home' })}
          title="Start over"
        >
          <BrandMark /> Chessly
        </button>
        <span className="tagline">Game review for your Chess.com games</span>
      </nav>

      <main>
        {view.kind === 'home' && <Home onSubmitUser={openUser} onSubmitPgn={openPgn} />}

        {view.kind === 'games' && (
          <GameBrowser
            key={view.username}
            username={view.username}
            onOpen={(game) => setView({ kind: 'analysis', game, from: view })}
            onChangeUser={() => {
              localStorage.removeItem(LAST_USER)
              setView({ kind: 'home' })
            }}
          />
        )}

        {view.kind === 'analysis' && (
          <AnalysisView
            key={view.game.id}
            game={view.game}
            preset={preset}
            onPresetChange={choosePreset}
            onBack={() => setView(view.from)}
          />
        )}
      </main>

      <footer className="footer">
        Analysis runs in your browser with Stockfish 19. Not affiliated with Chess.com.
      </footer>
    </div>
  )
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 45 45" aria-hidden="true">
      <g
        fill="#81b64c"
        stroke="#81b64c"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" />
        <path d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3" />
      </g>
    </svg>
  )
}

/** Stable-enough id for caching a pasted game. */
function hash(text: string): string {
  let value = 5381
  for (let i = 0; i < text.length; i++) value = ((value << 5) + value + text.charCodeAt(i)) | 0
  return (value >>> 0).toString(36)
}
