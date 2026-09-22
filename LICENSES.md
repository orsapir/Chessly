# Licences

Chessly itself is released under the GNU General Public License v3.0 — see
[LICENSE](LICENSE). It has to be: it ships Stockfish, which is GPLv3.

## Bundled third-party work

| what | where | licence |
| --- | --- | --- |
| Stockfish 19 compiled to WebAssembly, via [stockfish.js](https://github.com/nmrugg/stockfish.js) | `public/engine/` (copied from `node_modules` at install time) | GPLv3 |
| Chess pieces by Colin M. L. Burnett ("cburnett"), as distributed with Lichess | `src/components/pieces.ts` | GPLv2+ / CC BY-SA 3.0 |
| [chess.js](https://github.com/jhlywa/chess.js) | dependency | BSD-2-Clause |
| React | dependency | MIT |

The move accuracy curve and the win-percentage model follow the formulas
published by Lichess.

Chess.com game data is read through their public API. This project is not
affiliated with, endorsed by, or connected to Chess.com.
