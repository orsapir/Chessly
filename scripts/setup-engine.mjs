/**
 * Copies the Stockfish WASM builds out of node_modules into public/engine/ so
 * Vite serves them as plain static files (the engine is loaded as a classic
 * Web Worker, not through the bundler).
 *
 * Runs automatically on `npm install` and before `dev` / `build`.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'stockfish', 'bin')
const dest = join(root, 'public', 'engine')

// Only the "lite" builds: they carry the small NNUE net (~1.7 MB) instead of
// the 99 MB full one, which is the difference between a usable website and a
// download people abandon.
// The single-threaded build only: the app runs several of these side by side,
// which is both faster for this workload and free of the cross-origin
// isolation headers the multi-threaded build would demand.
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']

if (!existsSync(src)) {
  console.error('[setup-engine] node_modules/stockfish not found - run npm install first.')
  process.exit(0)
}

mkdirSync(dest, { recursive: true })

for (const file of files) {
  const from = join(src, file)
  const to = join(dest, file)
  if (!existsSync(from)) {
    console.warn(`[setup-engine] missing ${file}, skipping`)
    continue
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue
  copyFileSync(from, to)
  console.log(`[setup-engine] copied ${file}`)
}
