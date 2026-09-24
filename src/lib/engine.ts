import type { EngineLine, PositionEval, Score } from './types'

/**
 * Resolved when a worker is started rather than at import, so the module can
 * be loaded outside Vite - by the tests, among others.
 */
function engineUrl(): string {
  const base = (import.meta.env as ImportMetaEnv | undefined)?.BASE_URL || '/'
  return `${base}engine/stockfish-19-lite-single.js`
}

/**
 * Anything that can evaluate a position. A game is a few dozen independent
 * searches, so several single-threaded engines side by side beat one
 * multi-threaded engine - and they need no cross-origin isolation.
 */
export interface Analyser {
  readonly name: string
  readonly concurrency: number
  analyse(fen: string, options: AnalyseOptions): Promise<PositionEval>
  dispose(): void
}

export interface AnalyseOptions {
  depth: number
  multiPV?: number
  /**
   * Node ceiling. A handful of tangled positions would otherwise take ten
   * times as long as the median one and dominate the whole run.
   */
  maxNodes?: number
  /** Hard ceiling so a single position can never stall the run. */
  maxTimeMs?: number
}

type Resolver = (value: PositionEval) => void

/**
 * A single Stockfish worker speaking UCI, with requests serialized so the
 * engine is never asked two questions at once.
 */
export class Engine implements Analyser {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<(line: string) => void>()
  private disposed = false

  readonly name = 'Stockfish 19 Lite'
  readonly concurrency = 1

  private async boot(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = (async () => {
      this.worker = new Worker(engineUrl())
      this.worker.onmessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : String(event.data?.data ?? '')
        for (const listener of this.listeners) listener(line)
      }
      await this.command('uci', (line) => line === 'uciok')
      this.send(`setoption name Hash value ${hashSizeMb()}`)
      this.send('setoption name UCI_AnalyseMode value true')
      await this.command('isready', (line) => line === 'readyok')
    })()
    return this.ready
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd)
  }

  /** Sends a command and resolves when `done` sees the terminating line. */
  private command(cmd: string, done: (line: string) => boolean, onLine?: (line: string) => void) {
    return new Promise<void>((resolve) => {
      const listener = (line: string) => {
        onLine?.(line)
        if (done(line)) {
          this.listeners.delete(listener)
          resolve()
        }
      }
      this.listeners.add(listener)
      this.send(cmd)
    })
  }

  /** Evaluates one position. Calls are queued, so this is safe to await in a loop. */
  analyse(fen: string, options: AnalyseOptions): Promise<PositionEval> {
    const run = this.queue.then(() => this.runAnalysis(fen, options))
    // Keep the chain alive even if one position fails.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async runAnalysis(fen: string, options: AnalyseOptions): Promise<PositionEval> {
    await this.boot()
    if (this.disposed) throw new Error('Engine disposed')

    const multiPV = options.multiPV ?? 1
    const blackToMove = fen.split(' ')[1] === 'b'
    const best = new Map<number, EngineLine>()

    this.send(`setoption name MultiPV value ${multiPV}`)
    this.send(`position fen ${fen}`)

    let timer: ReturnType<typeof setTimeout> | undefined
    let resolveGuard: Resolver | undefined
    const guard = new Promise<PositionEval>((resolve) => {
      resolveGuard = resolve
    })

    const limits = options.maxNodes ? `depth ${options.depth} nodes ${options.maxNodes}` : `depth ${options.depth}`
    const search = this.command(
      `go ${limits}`,
      (line) => line.startsWith('bestmove'),
      (line) => {
        if (!line.startsWith('info ') || !line.includes(' pv ')) return
        const parsed = parseInfo(line, blackToMove)
        if (!parsed) return
        const previous = best.get(parsed.multipv)
        if (!previous || parsed.depth >= previous.depth) best.set(parsed.multipv, parsed)
      },
    ).then(() => {
      if (timer) clearTimeout(timer)
      return collect()
    })

    const collect = (): PositionEval => {
      const lines = [...best.values()].sort((a, b) => a.multipv - b.multipv)
      return { fen, lines, depth: lines[0]?.depth ?? 0, target: options.depth }
    }

    if (options.maxTimeMs) {
      timer = setTimeout(() => {
        this.send('stop')
        // If `bestmove` somehow never lands, return whatever we already have.
        setTimeout(() => resolveGuard?.(collect()), 500)
      }, options.maxTimeMs)
    }

    return Promise.race([search, guard])
  }

  dispose() {
    this.disposed = true
    this.listeners.clear()
    try {
      this.send('quit')
      this.worker?.terminate()
    } catch {
      /* worker already gone */
    }
    this.worker = null
    this.ready = null
  }
}

/** Hash per engine. Bigger is not better here - see the note in the README. */
function hashSizeMb(): number {
  const memory = deviceMemoryGb()
  return memory !== undefined && memory <= 4 ? 16 : 24
}

/**
 * Most engines worth running at once. Past this the gain is small and the
 * memory is not: each one holds a hash table, the network and its own stack.
 */
const MAX_ENGINES = 8

/** How much memory the browser admits to, in GB; Safari does not say. */
function deviceMemoryGb(): number | undefined {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  return typeof memory === 'number' ? memory : undefined
}

/**
 * How many engines to run, from what the browser will say about the device.
 *
 * Positions are independent searches, so this scales almost linearly, and the
 * limit that matters is memory rather than whether the thing is a phone: a
 * recent flagship has more cores and more RAM than plenty of laptops, and
 * capping it at four for being handheld left half its cores idle. One core is
 * always left over so the page itself stays responsive.
 *
 * Browsers round `deviceMemory` down to a power of two and stop at 8, so a
 * 12GB phone reports 8. Treat a missing value as mid-range rather than low:
 * Safari never reports it, and iPhones are not short of either resource.
 */
export function concurrencyFor(cores: number, memoryGb: number | undefined): number {
  const ceiling =
    memoryGb === undefined ? 5 : memoryGb <= 2 ? 2 : memoryGb <= 4 ? 3 : MAX_ENGINES
  return Math.max(1, Math.min(ceiling, cores - 1))
}

export function defaultConcurrency(): number {
  return concurrencyFor(navigator.hardwareConcurrency || 2, deviceMemoryGb())
}

/** Several engines sharing the work, one position at a time each. */
export class EnginePool implements Analyser {
  private engines: Engine[]
  private next = 0

  constructor(size = defaultConcurrency()) {
    this.engines = Array.from({ length: Math.max(1, size) }, () => new Engine())
  }

  get concurrency(): number {
    return this.engines.length
  }

  get name(): string {
    return this.engines.length > 1
      ? `Stockfish 19 Lite x${this.engines.length}`
      : 'Stockfish 19 Lite'
  }

  analyse(fen: string, options: AnalyseOptions): Promise<PositionEval> {
    const engine = this.engines[this.next % this.engines.length]
    this.next++
    return engine.analyse(fen, options)
  }

  dispose() {
    for (const engine of this.engines) engine.dispose()
    this.engines = []
  }
}

function parseInfo(line: string, blackToMove: boolean): EngineLine | null {
  const tokens = line.split(' ')
  const at = (key: string) => {
    const index = tokens.indexOf(key)
    return index === -1 ? null : tokens[index + 1]
  }

  const depth = Number(at('depth'))
  if (!Number.isFinite(depth)) return null

  const pvIndex = tokens.indexOf('pv')
  if (pvIndex === -1) return null
  const pv = tokens.slice(pvIndex + 1)
  if (!pv.length) return null

  const scoreIndex = tokens.indexOf('score')
  if (scoreIndex === -1) return null
  const kind = tokens[scoreIndex + 1]
  const raw = Number(tokens[scoreIndex + 2])
  if (!Number.isFinite(raw)) return null

  // UCI reports from the side to move; everything downstream is White's view.
  const flip = blackToMove ? -1 : 1
  const score: Score = kind === 'mate' ? { cp: null, mate: raw * flip } : { cp: raw * flip, mate: null }

  return { multipv: Number(at('multipv') ?? 1), depth, score, pv }
}
