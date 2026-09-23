import { useEffect, useRef, useState } from 'react'
import { MAX_DEPTH, MIN_DEPTH, PRESETS, settingsFor } from '../lib/analyze'

interface Props {
  depth: number
  onChange: (depth: number) => void
  disabled?: boolean
}

/**
 * Depth is the one knob worth exposing: it is the whole trade between waiting
 * and being sure. The line underneath says exactly what the chosen number buys,
 * including the fact that high depths are spent on the moves that matter.
 */
export function DepthControl({ depth, onChange, disabled }: Props) {
  // The slider reads live, but dragging across a dozen values must not start a
  // dozen analyses: the number the caller sees settles once the drag stops.
  const [dragging, setDragging] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])

  const commit = (next: number, delay: number) => {
    setDragging(next)
    clearTimeout(timer.current ?? undefined)
    timer.current = setTimeout(() => {
      setDragging(null)
      onChange(next)
    }, delay)
  }

  const settings = settingsFor(dragging ?? depth)
  const twoPass = settings.scanDepth < settings.depth

  return (
    <div className="depth-control">
      <div className="depth-head">
        <label htmlFor="depth-slider">
          Depth <strong>{settings.depth}</strong>
        </label>
        <div className="depth-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={settings.depth === preset.depth ? 'active' : ''}
              onClick={() => commit(preset.depth, 0)}
              disabled={disabled}
              title={preset.detail}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <input
        id="depth-slider"
        type="range"
        min={MIN_DEPTH}
        max={MAX_DEPTH}
        step={1}
        value={settings.depth}
        disabled={disabled}
        onChange={(event) => commit(Number(event.target.value), 400)}
      />

      <p className="depth-note">
        {twoPass ? (
          <>
            Every move is searched to depth {settings.scanDepth}; anything that cost something,
            offered material, or came down to a close choice is then re-searched to depth{' '}
            {settings.depth}.
          </>
        ) : (
          <>Every move searched to depth {settings.depth}.</>
        )}{' '}
        {estimate(settings.depth)}
      </p>
    </div>
  )
}

/**
 * Rough wall-clock for a 40-move game, from measured timings on a four-core
 * laptop. Deliberately vague: a phone is slower, a desktop much faster.
 */
function estimate(depth: number): string {
  if (depth <= 12) return 'A few seconds a game.'
  if (depth <= 16) return 'Ten to twenty seconds a game.'
  if (depth <= 20) return 'Half a minute or so a game.'
  return 'A minute or more — worth it for one game, not for twenty.'
}
