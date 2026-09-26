import { useEffect, useState } from 'react'

/**
 * Whether a CSS media query currently matches, as state. A phone and a desktop
 * want the review laid out differently enough that CSS cannot do it alone -
 * the move list belongs in a different part of the page on each - so the
 * component needs to know which it is drawing.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}
