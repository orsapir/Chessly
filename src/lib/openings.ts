/**
 * A compact opening book. Keys are space-separated SAN move sequences; the
 * value is the name shown in the report. Every prefix of every key counts as
 * "in book", which is what turns the first handful of moves grey instead of
 * praising a player for memorising 1. e4.
 */
const OPENINGS: Record<string, string> = {
  // 1. e4
  e4: "King's Pawn Opening",
  'e4 e5': "King's Pawn Game",
  'e4 e5 Nf3': "King's Knight Opening",
  'e4 e5 Nf3 Nc6 Bb5': 'Ruy López',
  'e4 e5 Nf3 Nc6 Bb5 a6': 'Ruy López, Morphy Defence',
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O': 'Ruy López, Closed',
  'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4': 'Ruy López, Open',
  'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6': 'Ruy López, Exchange',
  'e4 e5 Nf3 Nc6 Bb5 Nf6': 'Ruy López, Berlin Defence',
  'e4 e5 Nf3 Nc6 Bc4': 'Italian Game',
  'e4 e5 Nf3 Nc6 Bc4 Bc5': 'Giuoco Piano',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4': 'Italian Game, Main Line',
  'e4 e5 Nf3 Nc6 Bc4 Bc5 b4': 'Evans Gambit',
  'e4 e5 Nf3 Nc6 Bc4 Nf6': 'Two Knights Defence',
  'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5': 'Two Knights, Fried Liver',
  'e4 e5 Nf3 Nc6 d4': 'Scotch Game',
  'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5': 'Scotch Game, Classical',
  'e4 e5 Nf3 Nc6 Nc3': 'Three Knights Game',
  'e4 e5 Nf3 Nc6 Nc3 Nf6': 'Four Knights Game',
  'e4 e5 Nf3 Nf6': "Petrov's Defence",
  'e4 e5 Nf3 d6': 'Philidor Defence',
  'e4 e5 Nc3': 'Vienna Game',
  'e4 e5 f4': "King's Gambit",
  'e4 e5 Bc4': "Bishop's Opening",
  'e4 e5 d4': 'Centre Game',
  'e4 c5': 'Sicilian Defence',
  'e4 c5 Nf3': 'Sicilian Defence, Open',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6': 'Sicilian, Najdorf',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6': 'Sicilian, Dragon',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6': 'Sicilian, Scheveningen',
  'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6': 'Sicilian, Accelerated Dragon',
  'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6': 'Sicilian, Kan',
  'e4 c5 Nf3 Nc6 Bb5': 'Sicilian, Rossolimo',
  'e4 c5 Nf3 d6 Bb5+': 'Sicilian, Moscow',
  'e4 c5 Nc3': 'Sicilian, Closed',
  'e4 c5 c3': 'Sicilian, Alapin',
  'e4 c5 d4 cxd4 c3': 'Sicilian, Smith-Morra Gambit',
  'e4 c5 f4': 'Sicilian, Grand Prix Attack',
  'e4 e6': 'French Defence',
  'e4 e6 d4 d5 Nc3 Bb4': 'French, Winawer',
  'e4 e6 d4 d5 Nc3 Nf6': 'French, Classical',
  'e4 e6 d4 d5 Nd2': 'French, Tarrasch',
  'e4 e6 d4 d5 e5': 'French, Advance',
  'e4 e6 d4 d5 exd5': 'French, Exchange',
  'e4 c6': 'Caro-Kann Defence',
  'e4 c6 d4 d5 Nc3 dxe4 Nxe4': 'Caro-Kann, Main Line',
  'e4 c6 d4 d5 e5': 'Caro-Kann, Advance',
  'e4 c6 d4 d5 exd5 cxd5': 'Caro-Kann, Exchange',
  'e4 d5': 'Scandinavian Defence',
  'e4 d5 exd5 Qxd5 Nc3 Qa5': 'Scandinavian, Main Line',
  'e4 d6': 'Pirc Defence',
  'e4 g6': 'Modern Defence',
  'e4 Nf6': "Alekhine's Defence",
  'e4 Nc6': 'Nimzowitsch Defence',
  'e4 b6': "Owen's Defence",
  'e4 e5 Nf3 Nc6 Bc4 Bc5 c3': 'Italian Game, Giuoco Pianissimo',

  // 1. d4
  d4: "Queen's Pawn Opening",
  'd4 d5': "Queen's Pawn Game",
  'd4 d5 c4': "Queen's Gambit",
  'd4 d5 c4 dxc4': "Queen's Gambit Accepted",
  'd4 d5 c4 e6': "Queen's Gambit Declined",
  'd4 d5 c4 e6 Nc3 Nf6 Bg5': "Queen's Gambit Declined, Classical",
  'd4 d5 c4 e6 Nf3 Nf6 Nc3 c6': 'Semi-Slav Defence',
  'd4 d5 c4 c6': 'Slav Defence',
  'd4 d5 c4 Nc6': 'Chigorin Defence',
  'd4 d5 c4 e5': 'Albin Counter-Gambit',
  'd4 d5 Bf4': 'London System',
  'd4 d5 Nf3 Nf6 Bf4': 'London System',
  'd4 Nf6 Nf3 e6 Bf4': 'London System',
  'd4 d5 Nf3 Nf6 e3': 'Colle System',
  'd4 d5 e4': 'Blackmar-Diemer Gambit',
  'd4 Nf6': 'Indian Defence',
  'd4 Nf6 c4': 'Indian Game',
  'd4 Nf6 c4 e6 Nc3 Bb4': 'Nimzo-Indian Defence',
  'd4 Nf6 c4 e6 Nf3 b6': "Queen's Indian Defence",
  'd4 Nf6 c4 e6 g3': 'Catalan Opening',
  'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6': "King's Indian Defence",
  'd4 Nf6 c4 g6 Nc3 d5': 'Grünfeld Defence',
  'd4 Nf6 c4 c5 d5 e6': 'Benoni Defence',
  'd4 Nf6 c4 c5 d5 b5': 'Benko Gambit',
  'd4 Nf6 c4 e5': 'Budapest Gambit',
  'd4 Nf6 Bg5': 'Trompowsky Attack',
  'd4 f5': 'Dutch Defence',
  'd4 d6': 'Rat Defence',
  'd4 g6': 'Modern Defence',
  'd4 e6': "Queen's Pawn, Horwitz Defence",

  // Flank openings
  c4: 'English Opening',
  'c4 e5': 'English, Reversed Sicilian',
  'c4 c5': 'English, Symmetrical',
  'c4 Nf6': 'English, Anglo-Indian',
  'c4 e6': 'English, Agincourt Defence',
  Nf3: 'Réti Opening',
  'Nf3 d5 c4': 'Réti Opening',
  'Nf3 Nf6 g3': "King's Indian Attack",
  g3: "Benko's Opening",
  b3: 'Nimzo-Larsen Attack',
  f4: "Bird's Opening",
  b4: 'Sokolsky Opening',
  Nc3: 'Dunst Opening',
  e3: "Van 't Kruijs Opening",
}

/** Every prefix of every known line: used to decide whether we are still in book. */
const BOOK_POSITIONS = new Set<string>()
/** Exact lines only: used to name the opening. */
const NAMED_LINES = new Map<string, string>(Object.entries(OPENINGS))

for (const line of NAMED_LINES.keys()) {
  const moves = line.split(' ')
  for (let i = 1; i <= moves.length; i++) BOOK_POSITIONS.add(moves.slice(0, i).join(' '))
}

/** Longest book line we bother matching, in plies. */
export const BOOK_DEPTH = 20

export interface BookMatch {
  inBook: boolean
  name: string | null
}

/** Looks up a position by the SAN moves that reached it. */
export function lookupBook(sanMoves: string[]): BookMatch {
  if (!sanMoves.length || sanMoves.length > BOOK_DEPTH) return { inBook: false, name: null }
  const key = sanMoves.join(' ')
  if (!BOOK_POSITIONS.has(key)) return { inBook: false, name: null }
  return { inBook: true, name: detectOpening(sanMoves) }
}

/** The most specific opening name reached before the game left book. */
export function detectOpening(sanMoves: string[]): string | null {
  let name: string | null = null
  for (let i = 1; i <= Math.min(sanMoves.length, BOOK_DEPTH); i++) {
    const key = sanMoves.slice(0, i).join(' ')
    if (!BOOK_POSITIONS.has(key)) break
    name = NAMED_LINES.get(key) ?? name
  }
  return name
}
