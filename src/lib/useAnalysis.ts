import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AnalysisAborted,
  analyzeGame,
  nodeCapFor,
  settingsKey,
  type AnalysisSettings,
  type Phase,
} from './analyze'
import { readReport, writeReport } from './cache'
import { EnginePool } from './engine'
import type { GameReport, Score } from './types'

export interface AnalysisState {
  report: GameReport | null
  running: boolean
  progress: { done: number; total: number; phase: Phase }
  /**
   * Score for each position as the engine reaches it, indexed by ply. Lets the
   * board show an evaluation for whatever move is on screen while the rest of
   * the game is still being searched.
   */
  liveScores: (Score | null)[]
  error: string | null
  fromCache: boolean
}

const IDLE: AnalysisState = {
  report: null,
  running: false,
  progress: { done: 0, total: 0, phase: 'scan' },
  liveScores: [],
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

  const run = useCallback(async (gameId: string, pgn: string, settings: AnalysisSettings, force = false) => {
    const id = ++runId.current
    cancelled.current = false
    const key = settingsKey(settings)

    if (!force) {
      const cached = readReport(gameId, key)
      if (cached) {
        setState({ ...IDLE, report: cached, fromCache: true })
        return cached
      }
    }

    setState({ ...IDLE, running: true, progress: { done: 0, total: 1, phase: 'scan' } })
    pool.current ??= new EnginePool()

    // Batched rather than a setState per position: a long game lands ninety of
    // these in a few seconds and only the newest matters.
    const scores: (Score | null)[] = []
    let flush: ReturnType<typeof setTimeout> | null = null

    try {
      const report = await analyzeGame(pgn, pool.current, {
        settings,
        shouldStop: () => cancelled.current || runId.current !== id,
        onProgress: (done, total, phase) => {
          if (runId.current === id) setState((previous) => ({ ...previous, progress: { done, total, phase } }))
        },
        onPosition: (index, evaluation) => {
          if (runId.current !== id) return
          scores[index] = evaluation.lines[0]?.score ?? null
          flush ??= setTimeout(() => {
            flush = null
            if (runId.current === id) setState((previous) => ({ ...previous, liveScores: [...scores] }))
          }, 120)
        },
        onPreliminary: (preliminary) => {
          // Never cached: it is the shallow answer, and the real one follows.
          if (runId.current === id) setState((previous) => ({ ...previous, report: preliminary }))
        },
      })
      if (flush) clearTimeout(flush)
      if (runId.current !== id) return null
      writeReport(gameId, key, report)
      setState({ ...IDLE, report, liveScores: scores })
      return report
    } catch (error) {
      if (flush) clearTimeout(flush)
      if (runId.current !== id) return null
      if (error instanceof AnalysisAborted) {
        setState(IDLE)
        return null
      }
      setState({ ...IDLE, error: error instanceof Error ? error.message : 'Analysis failed.' })
      return null
    }
  }, [])

  /**
   * One position, on demand, on the same engines the run uses. For trying a
   * move out: it queues behind at most one position of an analysis in flight.
   */
  const analysePosition = useCallback(async (fen: string, depth: number) => {
    pool.current ??= new EnginePool()
    return pool.current.analyse(fen, { depth, multiPV: 1, maxNodes: nodeCapFor(depth), maxTimeMs: 20000 })
  }, [])

  return { ...state, run, cancel, reset, analysePosition }
}
