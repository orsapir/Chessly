import { CLASSIFICATION_META } from '../lib/evaluate'
import type { Classification } from '../lib/types'

/**
 * The coloured disc that marks a verdict, the same shape wherever a verdict
 * appears: on the board, beside a move, and in the summary table. Drawn rather
 * than set in text so it keeps its size on a phone, where the emoji a book
 * would otherwise need comes out in full colour and half a line tall.
 */
export function ClassBadge({
  classification,
  size = 18,
  x,
  y,
}: {
  classification: Classification
  size?: number
  /** Only for placing it inside another SVG, as the board does. */
  x?: number
  y?: number
}) {
  const meta = CLASSIFICATION_META[classification]
  return (
    <svg
      className="class-badge"
      width={size}
      height={size}
      x={x}
      y={y}
      viewBox="0 0 24 24"
      role="img"
      aria-label={meta.label}
    >
      <circle cx="12" cy="12" r="12" fill={meta.color} />
      {classification === 'book' ? (
        <path
          d="M6 6.5h4.6c.8 0 1.4.5 1.4 1.1v9.9c0-.6-.6-1.1-1.4-1.1H6V6.5zm12 0h-4.6c-.8 0-1.4.5-1.4 1.1v9.9c0-.6.6-1.1 1.4-1.1H18V6.5z"
          fill="#fff"
        />
      ) : (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={glyphSize(meta.glyph)}
          fontWeight="700"
        >
          {meta.glyph}
        </text>
      )}
    </svg>
  )
}

/** Two-character verdicts need to come down a little to fit the disc. */
function glyphSize(glyph: string): number {
  return glyph.length > 1 ? 11 : 14
}
