import type { GameSummary } from './types'

const API = 'https://api.chess.com/pub'

export interface Profile {
  username: string
  name?: string
  avatar?: string
  country?: string
  url: string
  followers?: number
  joined?: number
  status?: string
}

export interface Stats {
  chess_rapid?: RatingBucket
  chess_blitz?: RatingBucket
  chess_bullet?: RatingBucket
  chess_daily?: RatingBucket
}

interface RatingBucket {
  last?: { rating: number }
  record?: { win: number; loss: number; draw: number }
}

export class ChessComError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ChessComError'
    this.status = status
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}${path}`)
  } catch {
    // Almost always a network failure or an extension blocking the request:
    // the Chess.com public API itself sends permissive CORS headers.
    throw new ChessComError(
      'Could not reach the Chess.com API. Check your connection, or paste a PGN instead.',
    )
  }
  if (res.status === 404) throw new ChessComError('No such player on Chess.com.', 404)
  if (res.status === 429)
    throw new ChessComError('Chess.com is rate-limiting us. Wait a moment and try again.', 429)
  if (!res.ok) throw new ChessComError(`Chess.com returned ${res.status}.`, res.status)
  return (await res.json()) as T
}

const normalize = (username: string) => encodeURIComponent(username.trim().toLowerCase())

export function getProfile(username: string) {
  return get<Profile>(`/player/${normalize(username)}`)
}

export function getStats(username: string) {
  return get<Stats>(`/player/${normalize(username)}/stats`)
}

/** Month archives, oldest first, as `YYYY/MM` strings. */
export async function getArchives(username: string): Promise<string[]> {
  const { archives } = await get<{ archives: string[] }>(`/player/${normalize(username)}/games/archives`)
  return archives.map((url) => url.split('/games/')[1])
}

interface RawGame {
  url: string
  pgn?: string
  time_control: string
  end_time: number
  rated: boolean
  uuid?: string
  time_class: string
  rules: string
  white: { rating: number; result: string; username: string }
  black: { rating: number; result: string; username: string }
}

/** Games for one month, newest first. Only standard chess with a PGN. */
export async function getMonthGames(username: string, archive: string): Promise<GameSummary[]> {
  const { games } = await get<{ games: RawGame[] }>(`/player/${normalize(username)}/games/${archive}`)
  return games
    .filter((g) => g.rules === 'chess' && g.pgn)
    .map((g) => ({
      id: g.uuid ?? g.url,
      url: g.url,
      pgn: g.pgn as string,
      timeClass: g.time_class,
      timeControl: g.time_control,
      rated: g.rated,
      endTime: g.end_time,
      rules: g.rules,
      white: { username: g.white.username, rating: g.white.rating, result: g.white.result },
      black: { username: g.black.username, rating: g.black.rating, result: g.black.result },
    }))
    .sort((a, b) => b.endTime - a.endTime)
}

/** `2026/09` -> `September 2026`. */
export function formatArchive(archive: string): string {
  const [year, month] = archive.split('/')
  const date = new Date(Number(year), Number(month) - 1, 1)
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

const RESULT_LABELS: Record<string, string> = {
  win: 'Won',
  checkmated: 'Checkmated',
  agreed: 'Draw by agreement',
  repetition: 'Draw by repetition',
  timeout: 'Lost on time',
  resigned: 'Resigned',
  stalemate: 'Stalemate',
  lose: 'Lost',
  insufficient: 'Insufficient material',
  '50move': 'Draw by 50-move rule',
  abandoned: 'Abandoned',
  kingofthehill: 'King of the hill',
  threecheck: 'Three check',
  timevsinsufficient: 'Timeout vs insufficient material',
  bughousepartnerlose: "Partner lost",
}

export function resultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result
}

export type Outcome = 'win' | 'loss' | 'draw'

export function outcomeFor(game: GameSummary, username: string): Outcome {
  const side = game.white.username.toLowerCase() === username.toLowerCase() ? game.white : game.black
  if (side.result === 'win') return 'win'
  if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(side.result))
    return 'draw'
  return 'loss'
}
