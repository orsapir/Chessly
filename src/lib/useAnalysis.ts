import { useCallback, useEffect, useRef, useState } from 'react'
import { AnalysisAborted, analyzeGame, type Preset } from './analyze'
import { readReport, writeReport } from './cache'
import { EnginePool } from './engine'
import type { GameReport } from './types'

export interface AnalysisState {
  report: GameReport | null
  running: boolean
  progress: { done: number; total: number }
  error: string | null
  fromCache: boolean
}

const IDLE: AnalysisState = {
  report: null,
  running: false,
  progress: { done: 0, total: 0 },
  error: null,
  fromCache: false,
}

/**
 * Owns the engine pool for the lifetime of the page and runs one analysis at a
 * time. Finished reports are cached, so revisiting a game is instant.
 */
export function useAnalysis() {
  const [state, setState] = useState<AnalysisState>(IDLE)
  const pool = useRef<EnginePool | null>(null)
  const cancelled = useRef(false)
  const runId = useRef(0)

  useEffect(() => {
    return () => {
      cancelled.current = true
      pool.current?.dispose()
      pool.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    setState((previous) => ({ ...previous, running: false }))
  }, [])

  const reset = useCallback(() => {
    cancelled.current = true
    setState(IDLE)
  }, [])

  const run = useCallback(async (gameId: string, pgn: string, preset: Preset, force = false) => {
    const id = ++runId.current
    cancelled.current = false

    if (!force) {
      const cached = readReport(gameId, preset)
      if (cached) {
        setState({ report: cached, running: false, progress: { done: 0, total: 0 }, error: null, fromCache: true })
        return cached
      }
    }

    setState({ report: null, running: true, progress: { done: 0, total: 1 }, error: null, fromCache: false })
    pool.current ??= new EnginePool()

    try {
      const report = await analyzeGame(pgn, pool.current, {
        preset,
        shouldStop: () => cancelled.current || runId.current !== id,
        onProgress: (done, total) => {
          if (runId.current === id) setState((previous) => ({ ...previous, progress: { done, total } }))
        },
      })
      if (runId.current !== id) return null
      writeReport(gameId, preset, report)
      setState({ report, running: false, progress: { done: 0, total: 0 }, error: null, fromCache: false })
      return report
    } catch (error) {
      if (runId.current !== id) return null
      if (error instanceof AnalysisAborted) {
        setState(IDLE)
        return null
      }
      setState({
        report: null,
        running: false,
        progress: { done: 0, total: 0 },
        error: error instanceof Error ? error.message : 'Analysis failed.',
        fromCache: false,
      })
      return null
    }
  }, [])

  return { ...state, run, cancel, reset }
}
