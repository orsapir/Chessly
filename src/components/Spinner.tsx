/**
 * A ring that turns while the engine works. Under `prefers-reduced-motion` it
 * holds still and the numbers beside it carry the progress instead.
 */
export function Spinner({ size = 22 }: { size?: number }) {
  return (
    <svg className="spinner" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle className="spinner-track" cx="12" cy="12" r="9" />
      <circle className="spinner-head" cx="12" cy="12" r="9" />
    </svg>
  )
}
