import { useCallback, useEffect, useRef, useState } from 'react'
import { AnalysisAborted, analyzeGame, settingsKey, type AnalysisSettings, type Phase } from './analyze'
import { readReport, writeReport } from './cache'
import { EnginePool } from './engine'
import type { GameReport } from './types'

export interface AnalysisState {
  report: GameReport | null
  running: boolean
  progress: { done: number; total: number; phase: Phase }
  error: string | null
  fromCache: boolean
}

const IDLE: AnalysisState = {
  report: null,
  running: false,
  progress: { done: 0, total: 0, phase: 'scan' },
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

    try {
      const report = await analyzeGame(pgn, pool.current, {
        settings,
        shouldStop: () => cancelled.current || runId.current !== id,
        onProgress: (done, total, phase) => {
          if (runId.current === id) setState((previous) => ({ ...previous, progress: { done, total, phase } }))
        },
      })
      if (runId.current !== id) return null
      writeReport(gameId, key, report)
      setState({ ...IDLE, report })
      return report
    } catch (error) {
      if (runId.current !== id) return null
      if (error instanceof AnalysisAborted) {
        setState(IDLE)
        return null
      }
      setState({ ...IDLE, error: error instanceof Error ? error.message : 'Analysis failed.' })
      return null
    }
  }, [])

  return { ...state, run, cancel, reset }
}
