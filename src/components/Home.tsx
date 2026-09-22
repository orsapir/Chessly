import { useState } from 'react'
import { countCached } from '../lib/cache'

interface Props {
  onSubmitUser: (username: string) => void
  onSubmitPgn: (pgn: string) => void
}

export function Home({ onSubmitUser, onSubmitPgn }: Props) {
  const [username, setUsername] = useState('')
  const [pgn, setPgn] = useState('')
  const [showPgn, setShowPgn] = useState(false)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const cached = countCached()

  const submitPgn = () => {
    if (!pgn.trim()) return
    try {
      onSubmitPgn(pgn.trim())
    } catch {
      setPgnError('That does not look like a PGN I can read.')
    }
  }

  return (
    <div className="home">
      <h1>
        See where your games <em>actually</em> turned.
      </h1>
      <p className="lede">
        Type a Chess.com username. Every move gets an engine score and a verdict — brilliant,
        blunder, or the quiet inaccuracy that lost the endgame.
      </p>

      <form
        className="username-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (username.trim()) onSubmitUser(username.trim())
        }}
      >
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Chess.com username"
          autoComplete="username"
          autoFocus
          spellCheck={false}
        />
        <button type="submit" disabled={!username.trim()}>
          Find games
        </button>
      </form>

      <button className="ghost" onClick={() => setShowPgn((value) => !value)}>
        {showPgn ? 'Hide PGN input' : 'Or paste a PGN'}
      </button>

      {showPgn && (
        <div className="pgn-box">
          <textarea
            value={pgn}
            onChange={(event) => {
              setPgn(event.target.value)
              setPgnError(null)
            }}
            rows={8}
            placeholder={'[Event "Casual game"]\n\n1. e4 e5 2. Nf3 Nc6 …'}
            spellCheck={false}
          />
          {pgnError && <p className="error">{pgnError}</p>}
          <button onClick={submitPgn} disabled={!pgn.trim()}>
            Analyse this game
          </button>
        </div>
      )}

      <ul className="feature-list">
        <li>
          <strong>Move-by-move verdicts.</strong> Brilliant, great, best, book, inaccuracy, mistake,
          blunder — with the move you should have played.
        </li>
        <li>
          <strong>Accuracy and an evaluation graph.</strong> One glance tells you who was better and
          when that stopped being true.
        </li>
        <li>
          <strong>Nothing leaves your machine.</strong> Stockfish runs in your browser; games come
          straight from the public Chess.com API.
        </li>
      </ul>

      {cached > 0 && <p className="muted small">{cached} analysed games cached on this device.</p>}
    </div>
  )
}
