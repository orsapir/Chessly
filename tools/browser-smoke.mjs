/**
 * End-to-end smoke test against a running `npm run preview`, with the Chess.com
 * API replaced by fixtures so it runs offline.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run build && npm run preview &
 *   node tools/browser-smoke.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/chessly-shots'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const USER = 'minomss'

const pgn = (moves, result) => `[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.09.14"]
[White "minomss"]
[Black "opponent"]
[Result "${result}"]
[TimeControl "600"]

${moves} ${result}`

const games = [
  {
    url: 'https://www.chess.com/game/live/1',
    pgn: pgn('1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8#', '1-0'),
    time_control: '600', end_time: 1789000000, rated: true, uuid: 'game-1', time_class: 'rapid', rules: 'chess',
    white: { rating: 1240, result: 'win', username: 'minomss' },
    black: { rating: 1198, result: 'checkmated', username: 'opponent' },
  },
  {
    url: 'https://www.chess.com/game/live/2',
    pgn: pgn('1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 7. Bh4 b6 8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8 14. Bb5 a6 15. dxc5 bxc5 16. O-O Ra7 17. Be2 Nd7 18. Nd4 Qf8 19. Nxe6 fxe6 20. e4 d4 21. f4 Qe7', '1/2-1/2'),
    time_control: '180', end_time: 1788900000, rated: true, uuid: 'game-2', time_class: 'blitz', rules: 'chess',
    white: { rating: 1210, result: 'agreed', username: 'someone' },
    black: { rating: 1244, result: 'agreed', username: 'minomss' },
  },
  {
    url: 'https://www.chess.com/game/live/3',
    pgn: pgn('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3 Be7 9. Qd2 O-O 10. O-O-O Nbd7 11. g4 b5 12. g5 b4 13. Ne2 Ne8 14. f4 a5 15. f5 a4 16. fxe6 axb3 17. cxb3 fxe6', '0-1'),
    time_control: '60', end_time: 1788800000, rated: true, uuid: 'game-3', time_class: 'bullet', rules: 'chess',
    white: { rating: 1190, result: 'resigned', username: 'minomss' },
    black: { rating: 1265, result: 'win', username: 'rival' },
  },
  {
    url: 'https://www.chess.com/game/live/4', pgn: pgn('1. e4 e5', '1-0'),
    time_control: '600', end_time: 1788700000, rated: true, uuid: 'game-4', time_class: 'rapid', rules: 'chess960',
    white: { rating: 1, result: 'win', username: 'minomss' }, black: { rating: 1, result: 'resigned', username: 'x' },
  },
]

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
)
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

mkdirSync(SHOTS, { recursive: true })

const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

await page.route('**/api.chess.com/**', (route) => {
  const url = route.request().url()
  if (url.endsWith(`/player/${USER}`)) {
    return json(route, { username: USER, name: 'Min O.', url: `https://www.chess.com/member/${USER}`, joined: 1600000000, followers: 12, status: 'basic' })
  }
  if (url.endsWith('/stats')) {
    return json(route, { chess_rapid: { last: { rating: 1244 } }, chess_blitz: { last: { rating: 1188 } }, chess_bullet: { last: { rating: 1102 } } })
  }
  if (url.endsWith('/games/archives')) {
    return json(route, { archives: [`https://api.chess.com/pub/player/${USER}/games/2026/08`, `https://api.chess.com/pub/player/${USER}/games/2026/09`] })
  }
  if (url.endsWith('/games/2026/09')) return json(route, { games })
  if (url.endsWith('/games/2026/08')) return json(route, { games: [] })
  return route.fulfill({ status: 404, body: 'not found' })
})

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.locator('input[placeholder="Chess.com username"]').fill(USER)
await page.getByRole('button', { name: 'Find games' }).click()

await page.waitForSelector('.game-row', { timeout: 10000 })
console.log('games listed:', await page.locator('.game-row').count(), '(chess960 game should be filtered out)')
console.log('profile chips:', await page.locator('.profile-meta').innerText())
await page.screenshot({ path: `${SHOTS}/5-games.png` })

await page.locator('.segmented button', { hasText: 'Blitz' }).click()
await page.waitForTimeout(200)
console.log('after blitz filter:', await page.locator('.game-row').count())
await page.locator('.segmented button', { hasText: 'All' }).click()

await page.locator('.game-row').nth(2).click()
await page.waitForSelector('.accuracy-value', { timeout: 120000 })
console.log('board orientation flipped for black hero:', await page.evaluate(() => document.querySelector('.coords .on-dark')?.textContent))
console.log('accuracy:', (await page.locator('.accuracy-card').allInnerTexts()).map((t) => t.replace(/\n/g, ' ')))
await page.screenshot({ path: `${SHOTS}/6-analysis-from-api.png` })

await page.getByRole('button', { name: '← Games' }).click()
await page.waitForSelector('.game-row')
console.log('back to list ok')

// Cached revisit should skip the progress bar entirely.
await page.locator('.game-row').nth(2).click()
await page.waitForSelector('.accuracy-value', { timeout: 5000 })
console.log('cached revisit instant:', !(await page.locator('.progress').count()))

await page.setViewportSize({ width: 430, height: 900 })
await page.waitForTimeout(400)
await page.screenshot({ path: `${SHOTS}/7-mobile.png`, fullPage: true })

console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
