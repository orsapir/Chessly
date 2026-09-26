import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capturedMaterial } from '../src/lib/material'

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

test('nothing taken from the starting position', () => {
  const material = capturedMaterial(START)
  assert.equal(material.white, '')
  assert.equal(material.black, '')
  assert.deepEqual(material.edge, { white: 0, black: 0 })
})

test('counts each kind of piece once, not once per piece', () => {
  // Scandinavian: 1. e4 d5 2. exd5 Qxd5 - one pawn each. Both sides' glyphs
  // are the solid ones; which colour they read as is the strip's to say, since
  // the hollow and solid glyphs are wildly different sizes in most fonts.
  const material = capturedMaterial('rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3')
  assert.equal(material.white, '♟')
  assert.equal(material.black, '♟')
  assert.deepEqual(material.edge, { white: 0, black: 0 })
})

test('reads a material lead off the position', () => {
  // White is a whole queen up and has taken a pawn besides.
  const material = capturedMaterial('rnb1kbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  assert.equal(material.white, '♛♟')
  assert.equal(material.black, '')
  assert.deepEqual(material.edge, { white: 10, black: 0 })
})

test('an extra queen from a promotion is not a negative capture', () => {
  // Black promoted: two black queens on the board, nothing taken from White.
  const material = capturedMaterial('rnbqkbnr/pppppppp/8/8/8/5q2/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  assert.equal(material.black, '')
  assert.equal(material.edge.black, 9)
})
