import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGame } from '../src/lib/analyze'
import {
  classify,
  cpOf,
  formatScore,
  formatScoreCompact,
  gameAccuracy,
  isOnlyMove,
  moveAccuracy,
  winPercent,
  type ClassifyInput,
} from '../src/lib/evaluate'
import { detectOpening, lookupBook } from '../src/lib/openings'
import { sacrificeValue } from '../src/lib/see'

test('win percentage is centred, monotonic and bounded', () => {
  assert.equal(winPercent({ cp: 0, mate: null }), 50)
  assert.ok(winPercent({ cp: 300, mate: null }) > winPercent({ cp: 100, mate: null }))
  assert.equal(winPercent({ cp: null, mate: 3 }), 100)
  assert.equal(winPercent({ cp: null, mate: -3 }), 0)
  // Black's view is the mirror of White's.
  assert.equal(winPercent({ cp: 200, mate: null }, 'black'), 100 - winPercent({ cp: 200, mate: null }))
})

test('huge scores are clamped so a won game cannot get more won', () => {
  assert.equal(cpOf({ cp: 5000, mate: null }), 1000)
  assert.equal(cpOf({ cp: -5000, mate: null }), -1000)
})

test('scores are formatted the way a player reads them', () => {
  assert.equal(formatScore({ cp: 135, mate: null }), '+1.35')
  assert.equal(formatScore({ cp: -80, mate: null }), '−0.80')
  assert.equal(formatScore({ cp: null, mate: 4 }), 'M4')
  assert.equal(formatScore({ cp: null, mate: 4 }, 'black'), '-M4')
})

test('a perfect move is 100% accurate and a disaster approaches zero', () => {
  assert.ok(moveAccuracy(0) >= 99.9)
  assert.ok(moveAccuracy(50) < 15)
  assert.ok(moveAccuracy(100) < 5)
})

test('one blunder drags a game accuracy down', () => {
  const clean = Array.from({ length: 30 }, () => 100)
  const withBlunder = [...clean.slice(0, 29), moveAccuracy(40)]
  const wins = Array.from({ length: 30 }, (_, i) => 50 + i)
  assert.ok(gameAccuracy(clean, wins) > gameAccuracy(withBlunder, wins) + 2)
})

const base: ClassifyInput = {
  winBefore: 50,
  winAfter: 50,
  onlyMove: false,
  playedUci: 'e2e4',
  bestUci: 'e2e4',
  bestScore: { cp: 0, mate: null },
  color: 'white',
  legalMoveCount: 30,
  inBook: false,
  sacrifice: 0,
}

test('every classification is reachable', () => {
  assert.equal(classify({ ...base, legalMoveCount: 1 }), 'forced')
  assert.equal(classify({ ...base, inBook: true }), 'book')
  assert.equal(classify(base), 'best')
  assert.equal(classify({ ...base, playedUci: 'd2d4', winAfter: 49 }), 'excellent')
  assert.equal(classify({ ...base, playedUci: 'd2d4', winAfter: 47 }), 'good')
  assert.equal(classify({ ...base, playedUci: 'd2d4', winAfter: 42 }), 'inaccuracy')
  assert.equal(classify({ ...base, playedUci: 'd2d4', winAfter: 35 }), 'mistake')
  assert.equal(classify({ ...base, playedUci: 'd2d4', winAfter: 20 }), 'blunder')
  assert.equal(classify({ ...base, sacrifice: 300, winAfter: 60, winBefore: 60 }), 'brilliant')
  assert.equal(classify({ ...base, onlyMove: true, winAfter: 55, winBefore: 55 }), 'great')
  assert.equal(classify({ ...base, playedUci: 'd2d4', winBefore: 90, winAfter: 70 }), 'miss')
})

test('brilliance is not awarded for giving material back while crushing', () => {
  assert.equal(classify({ ...base, sacrifice: 400, winBefore: 96, winAfter: 95 }), 'best')
})

test('a great move has to change the standing of the game', () => {
  // Best by a mile, but the position stays winning either way.
  assert.equal(isOnlyMove(80, 68), false)
  assert.equal(classify({ ...base, winBefore: 80, winAfter: 80, onlyMove: false }), 'best')
  // A gap that drops the game from winning to unclear is the real thing.
  assert.equal(isOnlyMove(70, 45), true)
  assert.equal(isOnlyMove(70, 55), false, 'a gap under 20 points is not an only move')
})

/** FEN of the position before the given ply of a PGN. */
function positionBefore(pgn: string, ply: number): string {
  return parseGame(pgn).positions[ply]
}

const OPERA =
  '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 ' +
  '9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 ' +
  '15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0'

test('static exchange evaluation spots a real sacrifice', () => {
  // Morphy's 13. Rxd7: a rook for a knight, and the rook is taken straight back.
  assert.ok(sacrificeValue(positionBefore(OPERA, 24), 'd1d7') >= 180)
})

test('a developing move that hangs nothing is not a sacrifice', () => {
  const start = parseGame('1. e4 e5 *').positions[0]
  assert.equal(sacrificeValue(start, 'e2e4'), 0)
  assert.equal(sacrificeValue(start, 'g1f3'), 0)
})

test('an even recapture is not a sacrifice', () => {
  // 2. exd5 wins a pawn and Qxd5 only takes it back.
  assert.ok(sacrificeValue(positionBefore('1. e4 d5 2. exd5 Qxd5 *', 2), 'e4d5') <= 0)
})

test('a knight offered for a pawn counts as material given up', () => {
  // 4. Nxe5 grabs a pawn and loses the knight to 4... Nxe5.
  const fen = positionBefore('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. Nxe5 Nxe5 *', 6)
  assert.ok(sacrificeValue(fen, 'f3e5') >= 180)
})

test('the book knows theory and stops at the edge of it', () => {
  assert.ok(lookupBook(['e4', 'e5', 'Nf3']).inBook)
  assert.equal(lookupBook(['a4', 'h5']).inBook, false)
  assert.equal(detectOpening(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']), 'Sicilian, Najdorf')
  assert.equal(detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), 'Ruy López')
})

test('a PGN becomes one position per ply', () => {
  const game = parseGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1/2-1/2')
  assert.equal(game.moves.length, 6)
  assert.equal(game.positions.length, 7)
  assert.equal(game.moves[0].uci, 'e2e4')
  assert.equal(game.moves[1].color, 'black')
  assert.equal(game.result, '1/2-1/2')
  assert.equal(game.positions[0], game.moves[0].fenBefore)
})

test('the bar label drops the second decimal but keeps mates intact', () => {
  assert.equal(formatScoreCompact({ cp: 72, mate: null }), '+0.7')
  assert.equal(formatScoreCompact({ cp: -1250, mate: null }), '−12.5')
  assert.equal(formatScoreCompact({ cp: 0, mate: null }), '+0.0')
  assert.equal(formatScoreCompact({ cp: null, mate: 3 }), 'M3')
  assert.equal(formatScoreCompact({ cp: 72, mate: null }, 'black'), '−0.7')
})
