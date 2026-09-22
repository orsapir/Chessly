import { useEffect, useMemo, useState } from 'react'
import {
  ChessComError,
  formatArchive,
  getArchives,
  getMonthGames,
  getProfile,
  getStats,
  outcomeFor,
  resultLabel,
  type Profile,
  type Stats,
} from '../lib/chesscom'
import type { GameSummary } from '../lib/types'
import type { GameMeta } from './AnalysisView'

interface Props {
  username: string
  onOpen: (game: GameMeta) => void
  onChangeUser: () => void
}

const TIME_CLASSES = ['all', 'bullet', 'blitz', 'rapid', 'daily'] as const
type TimeFilter = (typeof TIME_CLASSES)[number]

export function GameBrowser({ username, onOpen, onChangeUser }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [archives, setArchives] = useState<string[]>([])
  const [archive, setArchive] = useState<string | null>(null)
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)  // the profile fetch starts immediately
  const [error, setError] = useState<string | null>(null)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  // Mounted fresh per username (App keys on it), so nothing needs resetting here.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const [profileResult, archiveList] = await Promise.all([getProfile(username), getArchives(username)])
        if (!live) return
        setProfile(profileResult)
        setArchives([...archiveList].reverse())
        setArchive(archiveList[archiveList.length - 1] ?? null)
        getStats(username)
          .then((value) => live && setStats(value))
          .catch(() => undefined)
        if (!archiveList.length) setLoading(false)
      } catch (caught) {
        if (!live) return
        setError(caught instanceof ChessComError ? caught.message : 'Something went wrong.')
        setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [username])

  useEffect(() => {
    if (!archive) return
    let live = true
    setLoading(true)
    setError(null)
    getMonthGames(username, archive)
      .then((result) => live && setGames(result))
      .catch((caught) => live && setError(caught instanceof ChessComError ? caught.message : 'Could not load games.'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [username, archive])

  const filtered = useMemo(
    () => games.filter((game) => timeFilter === 'all' || game.timeClass === timeFilter),
    [games, timeFilter],
  )

  const ratings = [
    ['Rapid', stats?.chess_rapid?.last?.rating],
    ['Blitz', stats?.chess_blitz?.last?.rating],
    ['Bullet', stats?.chess_bullet?.last?.rating],
  ].filter(([, rating]) => typeof rating === 'number') as [string, number][]

  return (
    <div className="browser">
      <header className="profile">
        {profile?.avatar ? (
          <img className="avatar" src={profile.avatar} alt="" />
        ) : (
          <div className="avatar placeholder">{username.slice(0, 1).toUpperCase()}</div>
        )}
        <div className="profile-text">
          <h2>{profile?.name ?? profile?.username ?? username}</h2>
          <div className="profile-meta">
            <span>@{profile?.username ?? username}</span>
            {ratings.map(([label, rating]) => (
              <span key={label} className="chip">
                {label} {rating}
              </span>
            ))}
          </div>
        </div>
        <button className="ghost" onClick={onChangeUser}>
          Change player
        </button>
      </header>

      <div className="filters">
        <select value={archive ?? ''} onChange={(event) => setArchive(event.target.value)}>
          {archives.map((month) => (
            <option key={month} value={month}>
              {formatArchive(month)}
            </option>
          ))}
        </select>
        <div className="segmented">
          {TIME_CLASSES.map((value) => (
            <button
              key={value}
              className={timeFilter === value ? 'active' : ''}
              onClick={() => setTimeFilter(value)}
            >
              {value === 'all' ? 'All' : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <span className="count">{filtered.length} games</span>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading games…</p>}
      {!loading && !error && !filtered.length && <p className="muted">No games in this month.</p>}

      <ul className="game-list">
        {filtered.map((game) => {
          const outcome = outcomeFor(game, username)
          const heroIsWhite = game.white.username.toLowerCase() === username.toLowerCase()
          const opponent = heroIsWhite ? game.black : game.white
          const hero = heroIsWhite ? game.white : game.black
          return (
            <li key={game.id}>
              <button
                className="game-row"
                onClick={() =>
                  onOpen({
                    id: game.id,
                    pgn: game.pgn,
                    white: { username: game.white.username, rating: game.white.rating },
                    black: { username: game.black.username, rating: game.black.rating },
                    url: game.url,
                    timeClass: game.timeClass,
                    endTime: game.endTime,
                    hero: username,
                  })
                }
              >
                <span className={`outcome ${outcome}`} title={resultLabel(hero.result)}>
                  {outcome === 'win' ? '+' : outcome === 'loss' ? '−' : '='}
                </span>
                <span className="opponent">
                  <span className={`dot ${heroIsWhite ? 'black' : 'white'}`} />
                  {opponent.username}
                  <span className="rating">{opponent.rating}</span>
                </span>
                <span className="game-meta">
                  <span className="chip">{game.timeClass}</span>
                  {!game.rated && <span className="chip">unrated</span>}
                  <span className="muted">{resultLabel(hero.result)}</span>
                </span>
                <span className="date">{new Date(game.endTime * 1000).toLocaleDateString()}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
