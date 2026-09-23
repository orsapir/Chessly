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

      {disabled && (
        <p className="depth-locked">
          <span className="depth-lock-dot" />
          <span>
            Locked while the engine is working. Press <strong>Stop</strong> under the board to
            change the depth.
          </span>
        </p>
      )}

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
 * Rough wall-clock for a 45-move game, measured on a four-core laptop running
 * three engines. A phone takes roughly twice as long; a desktop with more
 * cores, less.
 */
function estimate(depth: number): string {
  const phone = ' Roughly double on a phone.'
  if (depth <= 12) return `A few seconds a game.${phone}`
  if (depth <= 15) return `Ten seconds or so a game.${phone}`
  if (depth <= 17) return `Fifteen seconds or so a game.${phone}`
  if (depth <= 18) return `Twenty to thirty seconds a game.${phone}`
  if (depth <= 20) return `About a minute a game.${phone}`
  if (depth <= 22) return `Two minutes or so a game.${phone}`
  return `Around three minutes a game.${phone} For one game you care about, not for twenty.`
}
