import assert from 'node:assert/strict'
import { test } from 'node:test'
import { concurrencyFor } from '../src/lib/engine'

test('a flagship phone gets its cores, not a handheld penalty', () => {
  // Galaxy S25 Ultra: 8 cores, 12GB, which browsers round down and report as 8.
  assert.equal(concurrencyFor(8, 8), 7)
  // A recent iPhone, where Safari never reports memory at all.
  assert.equal(concurrencyFor(6, undefined), 5)
})

test('modest devices stay modest', () => {
  assert.equal(concurrencyFor(4, 2), 2, 'a 2GB phone runs two engines')
  assert.equal(concurrencyFor(8, 4), 3, 'cores are no use without memory behind them')
  assert.equal(concurrencyFor(2, 8), 1, 'and memory is no use without cores')
  assert.equal(concurrencyFor(1, 8), 1, 'never returns zero')
})

test('one core is always left for the page', () => {
  for (const cores of [2, 4, 6, 8]) {
    assert.ok(concurrencyFor(cores, 8) <= cores - 1, `${cores} cores must leave one spare`)
  }
})

test('the ceiling holds on a big desktop', () => {
  assert.equal(concurrencyFor(16, 8), 8)
  assert.equal(concurrencyFor(64, 8), 8)
})
