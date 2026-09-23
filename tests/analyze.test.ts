import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Chess } from 'chess.js'
import { MAX_DEPTH, MIN_DEPTH, analyzeGame, parseGame, settingsFor, settingsKey } from '../src/lib/analyze'
import type { Analyser } from '../src/lib/engine'
import type { PositionEval } from '../src/lib/types'

test('depth settings clamp, and only deep runs get a scan pass', () => {
  assert.deepEqual(settingsFor(12), { depth: 12, scanDepth: 12 })
  assert.deepEqual(settingsFor(18), { depth: 18, scanDepth: 13 })
  assert.deepEqual(settingsFor(16), { depth: 16, scanDepth: 13 })
  assert.equal(settingsFor(99).depth, MAX_DEPTH)
  assert.equal(settingsFor(1).depth, MIN_DEPTH)
  assert.equal(settingsFor(14.6).depth, 15)
  assert.equal(settingsKey(settingsFor(12)), 'd12')
  assert.equal(settingsKey(settingsFor(18)), 's13d18')
})

const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 d6 5. Bg5 Qd7 6. Nbd2 Nf6 7. h3 O-O *'

/**
 * Stands in for Stockfish: every position is level except one, which is lost
 * for White - so the move into it, and the move back out of it, both look
 * expensive. Records what it was asked, so the two-pass logic can be checked
 * without running a real search.
 */
function stubEngine(lostPosition: number) {
  const { positions } = parseGame(PGN)
  const asked: { index: number; depth: number }[] = []

  const analyse = async (fen: string, options: { depth: number }): Promise<PositionEval> => {
    const index = positions.indexOf(fen)
    asked.push({ index, depth: options.depth })
    const chess = new Chess(fen)
    const moves = chess.moves({ verbose: true })
    const cp = index === lostPosition ? -400 : 0
    return {
      fen,
      depth: options.depth,
      lines: [
        { multipv: 1, depth: options.depth, score: { cp, mate: null }, pv: [moves[0].lan] },
        { multipv: 2, depth: options.depth, score: { cp: cp - 20, mate: null }, pv: [moves[1].lan] },
      ],
    }
  }

  return { asked, engine: { analyse, name: 'stub', concurrency: 1, dispose() {} } as Analyser }
}

test('the deep pass covers the moves that cost something, and their neighbours', async () => {
  const { asked, engine } = stubEngine(9)
  const report = await analyzeGame(PGN, engine, { settings: { depth: 20, scanDepth: 10 } })

  const deepened = new Set(asked.filter((call) => call.depth === 20).map((call) => call.index))
  // Ply 8 walks into the lost position and ply 9 walks back out of it, so
  // positions 8, 9 and 10 all have to be re-searched to judge that pair.
  assert.ok(deepened.has(8), 'position before the blunder was re-searched')
  assert.ok(deepened.has(9), 'the lost position was re-searched')
  assert.ok(deepened.has(10), 'position after it was re-searched')
  // The opening is book and level, so it is left at scan depth.
  assert.ok(!deepened.has(1), 'quiet book positions were left alone')
  assert.ok(deepened.size < report.moves.length, 'the deep pass is a subset, not everything')
})

test('a verdict never mixes a deep search with a shallow one', async () => {
  const { asked, engine } = stubEngine(9)
  const report = await analyzeGame(PGN, engine, { settings: { depth: 20, scanDepth: 10 } })

  for (const move of report.moves) {
    assert.ok(move.depth === 10 || move.depth === 20, `unexpected verdict depth ${move.depth}`)
  }
  assert.equal(report.moves[8].depth, 20, 'the blunder is judged at full depth')
  assert.equal(report.settings.depth, 20)

  // Book positions are depth-capped, so pulling one into the deep pass would
  // silently pair a shallow search with a deep one.
  const deepCalls = asked.filter((call) => call.depth === 20)
  assert.ok(deepCalls.length > 0)
  assert.ok(
    deepCalls.every((call) => call.index >= 6),
    'no depth-capped book position was re-searched as if it were deep',
  )
})

test('a scan-depth verdict and a deep verdict never share a move', async () => {
  const { engine } = stubEngine(9)
  const shallow = await analyzeGame(PGN, engine, { settings: { depth: 10, scanDepth: 10 } })
  const twoPass = await analyzeGame(PGN, engine, { settings: { depth: 20, scanDepth: 10 } })

  // Moves the deep pass ignored must come out exactly as the uniform run had
  // them: the scan result is reused, not recomputed against a deeper neighbour.
  for (const [ply, move] of twoPass.moves.entries()) {
    if (move.depth !== 10) continue
    assert.equal(move.classification, shallow.moves[ply].classification, `ply ${ply} drifted`)
    assert.equal(move.loss.toFixed(6), shallow.moves[ply].loss.toFixed(6))
  }
})

test('a uniform run searches every position once at the chosen depth', async () => {
  const { asked, engine } = stubEngine(9)
  const { positions } = parseGame(PGN)
  await analyzeGame(PGN, engine, { settings: { depth: 12, scanDepth: 12 } })

  assert.equal(asked.length, positions.length)
  // Book positions are capped; the rest get the full 12.
  assert.ok(asked.every((call) => call.depth <= 12))
  assert.ok(asked.some((call) => call.depth === 12))
})
