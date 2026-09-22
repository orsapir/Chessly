# Chessly

Game review for your Chess.com games. Type a username, pick a game, and every
move gets an engine evaluation and a verdict — brilliant, great, best, book,
inaccuracy, mistake, blunder — plus accuracy, an evaluation graph and the move
you should have played instead.

Stockfish runs in your browser as a Web Worker. Nothing is uploaded, there is no
backend, and games come straight from the public Chess.com API.

![Chessly analysing a game](docs/screenshot.png)

## Running it

```bash
npm install     # also copies the Stockfish build into public/engine
npm run dev     # http://localhost:5173
```

Other scripts:

| command | what it does |
| --- | --- |
| `npm run build` | type-checks and builds into `dist/` |
| `npm run preview` | serves the production build |
| `npm test` | unit tests for the scoring and classification logic |
| `npm run analyze -- "<pgn>" [fast\|balanced\|deep]` | analyses a game in the terminal |

Deploying is a static upload of `dist/` to any host. The only requirement is
that `.wasm` files are served as `application/wasm`, which every mainstream
static host does by default.

## How the analysis works

Each position in the game is searched once with `MultiPV 2`, so for every move
we know both what was played and what the engine preferred. The evaluation
after a move comes from the search of the next position, which keeps the two
numbers on the same footing.

**Win percentage, not centipawns.** Scores are converted with the standard
logistic curve, because losing half a pawn at level material matters and losing
half a pawn when you are already up a rook does not.

**Classification** is driven by how much win percentage a move gives up:

| verdict | rule |
| --- | --- |
| Book | the move is still in the opening book (`src/lib/openings.ts`) |
| Forced | it was the only legal move |
| Brilliant | gives up at least 1.8 pawns of material beyond recapture, is still the engine's choice, and keeps the game at least level — and the player was not already winning |
| Great | the only move that changes the standing of the game; every alternative is at least 20% worse |
| Best | the engine's first choice |
| Excellent / Good | gives up under 2% / under 5% |
| Inaccuracy / Mistake / Blunder | under 10% / under 20% / 20% or more |
| Miss | a win or a mate was on the board and went by, but the game is not lost |

Sacrifices are detected with a static exchange evaluation over legal moves
(`src/lib/see.ts`), so a recapture-in-disguise does not count as a sacrifice.

**Accuracy** uses Lichess's per-move curve, combined into a game figure as the
mean of a volatility-weighted mean and a harmonic mean — the weighting stops
quiet, decided positions from inflating the number, and the harmonic mean stops
one blunder from being averaged away. Book and forced moves are excluded: they
were never a decision. The "level" beside the accuracy is a rough calibration
against online play, shown only when there are enough real decisions to judge.

**Speed.** Several single-threaded engines run side by side (one position each)
rather than one multi-threaded engine, which is faster for this workload and
avoids needing cross-origin isolation headers. A 40-move game takes a few
seconds on Fast and around half a minute on Deep. Finished reports are cached in
`localStorage`, so reopening a game is instant.

## Layout

```
src/lib/        engine worker, Chess.com client, analysis pipeline, scoring
src/components/ board, eval bar, eval graph, move list, report, screens
tools/          terminal analyser and browser smoke test
tests/          unit tests for the scoring rules
```

## Credits

Stockfish 19 (GPLv3), [stockfish.js](https://github.com/nmrugg/stockfish.js),
[chess.js](https://github.com/jhlywa/chess.js), and the cburnett piece set by
Colin M. L. Burnett. See [LICENSES.md](LICENSES.md).

Not affiliated with Chess.com.
