/**
 * The handful of glyphs the control bar needs, drawn rather than typed. The
 * unicode equivalents (⏮ ▶❙ ⇅) render at wildly different sizes and baselines
 * across phone fonts, which is why a chess site ships its own.
 */
const PATHS: Record<string, string> = {
  start: 'M6 5v14h2.5V5H6zm13 0-9 7 9 7V5z',
  prev: 'M15.5 5 7 12l8.5 7V5z',
  next: 'M8.5 5 17 12l-8.5 7V5z',
  end: 'M18 5v14h-2.5V5H18zM5 5l9 7-9 7V5z',
  play: 'M7 4.5 19.5 12 7 19.5v-15z',
  pause: 'M7 5h3.5v14H7V5zm6.5 0H17v14h-3.5V5z',
  flip: 'M7 3.5 3 8h3v6.5h2V8h3L7 3.5zM17 20.5 21 16h-3V9.5h-2V16h-3l4 4.5z',
  gear:
    'M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm8.4 3.5c0-.5 0-1-.1-1.4l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.4-1.4L15.2 2h-4l-.3 2.6c-.9.3-1.7.8-2.4 1.4l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.9l-2 1.6 2 3.4 2.4-1c.7.6 1.5 1.1 2.4 1.4l.3 2.6h4l.3-2.6c.9-.3 1.7-.8 2.4-1.4l2.4 1 2-3.4-2-1.6c.1-.5.1-1 .1-1.4z',
  back: 'M15.5 4 7.5 12l8 8 1.8-1.8L11 12l6.3-6.2L15.5 4z',
  chart: 'M4 19h16v2H4v-2zm2-7h3v6H6v-6zm5-6h3v12h-3V6zm5 3h3v9h-3V9z',
}

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} fill="currentColor" />
    </svg>
  )
}
