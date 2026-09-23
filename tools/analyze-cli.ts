/**
 * Node harness for the analysis pipeline: same code the website runs, driven by
 * the Stockfish build from node_modules instead of a Web Worker.
 *
 *   npx tsx tools/analyze-cli.ts "<pgn>" [depth]
 */
import { createRequire } from 'node:module'
import { analyzeGame, settingsFor, type AnalysisSettings } from '../src/lib/analyze'
import { CLASSIFICATION_META, formatScore } from '../src/lib/evaluate'
import type { Analyser } from '../src/lib/engine'
import type { EngineLine, PositionEval, Score } from '../src/lib/types'

const require = createRequire(import.meta.url)

async function nodeEngine(): Promise<Analyser> {
  const initEngine = require('stockfish')
  const sf = await initEngine('lite-single')
  let queue: Promise<unknown> = Promise.resolve()

  const analyse = (fen: string, options: { depth: number; multiPV?: number; maxNodes?: number }) => {
    const run = queue.then(
      () =>
        new Promise<PositionEval>((resolve) => {
          const blackToMove = fen.split(' ')[1] === 'b'
          const best = new Map<number, EngineLine>()
          sf.listener = (line: string) => {
            if (line.startsWith('info ') && line.includes(' pv ')) {
              const parsed = parseInfo(line, blackToMove)
              if (parsed) best.set(parsed.multipv, parsed)
            } else if (line.startsWith('bestmove')) {
              const lines = [...best.values()].sort((a, b) => a.multipv - b.multipv)
              resolve({ fen, lines, depth: lines[0]?.depth ?? 0, target: options.depth })
            }
          }
          sf.sendCommand(`setoption name MultiPV value ${options.multiPV ?? 1}`)
          sf.sendCommand(`position fen ${fen}`)
          sf.sendCommand(
            options.maxNodes
              ? `go depth ${options.depth} nodes ${options.maxNodes}`
              : `go depth ${options.depth}`,
          )
        }),
    )
    queue = run.catch(() => undefined)
    return run
  }

  return { analyse, name: 'Stockfish 19 Lite (node)', concurrency: 1, dispose() {} }
}

function parseInfo(line: string, blackToMove: boolean): EngineLine | null {
  const tokens = line.split(' ')
  const at = (key: string) => {
    const index = tokens.indexOf(key)
    return index === -1 ? null : tokens[index + 1]
  }
  const depth = Number(at('depth'))
  const pvIndex = tokens.indexOf('pv')
  const scoreIndex = tokens.indexOf('score')
  if (!Number.isFinite(depth) || pvIndex === -1 || scoreIndex === -1) return null
  const raw = Number(tokens[scoreIndex + 2])
  const flip = blackToMove ? -1 : 1
  const score: Score =
    tokens[scoreIndex + 1] === 'mate' ? { cp: null, mate: raw * flip } : { cp: raw * flip, mate: null }
  return { multipv: Number(at('multipv') ?? 1), depth, score, pv: tokens.slice(pvIndex + 1) }
}

const pgn = process.argv[2]
if (!pgn) {
  console.error('usage: npx tsx tools/analyze-cli.ts "<pgn>" [depth] [--uniform]')
  process.exit(1)
}
const depth = Number(process.argv[3] ?? 14)
const uniform = process.argv.includes('--uniform')
const settings: AnalysisSettings = uniform
  ? { depth, scanDepth: depth }
  : settingsFor(depth)

const engine = await nodeEngine()
const started = Date.now()
const report = await analyzeGame(pgn, engine, {
  settings,
  onProgress: (done, total, phase) => process.stderr.write(`\r${phase} ${done}/${total}    `),
})
process.stderr.write('\n')

console.log(
  `opening: ${report.opening ?? 'unknown'}   engine: ${report.engine}   ` +
    `scan d${report.settings.scanDepth} / deep d${report.settings.depth}   ` +
    `${report.moves.filter((move) => move.depth >= report.settings.depth).length}/${report.moves.length} moves at full depth`,
)
console.log(`took ${((Date.now() - started) / 1000).toFixed(1)}s`)
for (const move of report.moves) {
  const meta = CLASSIFICATION_META[move.classification]
  const prefix = move.color === 'white' ? `${move.moveNumber}.` : `${move.moveNumber}...`
  console.log(
    `${prefix.padStart(6)} ${move.san.padEnd(8)} ${formatScore(move.score).padStart(7)}  ` +
      `${meta.label.padEnd(11)} d${String(move.depth).padEnd(2)} loss=${move.loss.toFixed(1).padStart(5)} ` +
      `${move.sacrifice ? `sac=${move.sacrifice} ` : ''}${move.bestMoveSan && move.bestMoveSan !== move.san ? `best=${move.bestMoveSan}` : ''}`,
  )
}
for (const side of ['white', 'black'] as const) {
  const player = report[side]
  console.log(
    `${side}: accuracy ${player.accuracy.toFixed(1)}  acpl ${player.acpl}  est ${player.estimatedRating}  ` +
      Object.entries(player.counts)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}:${count}`)
        .join(' '),
  )
}
process.exit(0)
