import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

/**
 * The module caches whether real storage works, so each case needs a fresh
 * import with `window` already set up the way that browser behaves.
 */
async function loadWith(storage: () => unknown) {
  const globals = globalThis as { window?: unknown }
  Object.defineProperty(globals, 'window', {
    value: Object.defineProperty({}, 'localStorage', { get: storage, configurable: true }),
    configurable: true,
    writable: true,
  })
  return import(`../src/lib/storage.ts?case=${Math.random()}`)
}

function workingStorage() {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

test('reads and writes go to the browser when it allows them', async () => {
  const storage = workingStorage()
  const { readItem, writeItem, removeItem, keysWithPrefix, isPersistent } = await loadWith(() => storage)

  assert.equal(isPersistent(), true)
  assert.equal(writeItem('chessly:a', '1'), true)
  assert.equal(readItem('chessly:a'), '1')
  assert.deepEqual(keysWithPrefix('chessly:'), ['chessly:a'])
  removeItem('chessly:a')
  assert.equal(readItem('chessly:a'), null)
})

test('a browser that refuses storage never throws at the caller', async () => {
  // Safari with "Block All Cookies" throws on every access, reads included.
  const refuse = () => {
    throw new Error('The operation is insecure.')
  }
  const { readItem, writeItem, removeItem, keysWithPrefix, isPersistent } = await loadWith(refuse)

  assert.equal(isPersistent(), false, 'the page should know storage will not persist')
  assert.doesNotThrow(() => readItem('chessly:a'))
  assert.equal(readItem('chessly:a'), null)
  // Falls back to memory, so preferences still work for this tab.
  assert.equal(writeItem('chessly:a', '1'), true)
  assert.equal(readItem('chessly:a'), '1')
  assert.deepEqual(keysWithPrefix('chessly:'), ['chessly:a'])
  assert.doesNotThrow(() => removeItem('chessly:a'))
  assert.equal(readItem('chessly:a'), null)
})

test('a full quota is reported, not thrown', async () => {
  // A nearly-full store still takes small writes - which is why the probe
  // succeeds - and rejects the big one the cache wants to make.
  const base = workingStorage()
  const storage = {
    ...base,
    setItem: (key: string, value: string) => {
      if (value.length > 8) throw new Error('QuotaExceededError')
      base.setItem(key, value)
    },
  }
  const { writeItem, isPersistent } = await loadWith(() => storage)

  assert.equal(isPersistent(), true)
  assert.equal(writeItem('chessly:small', 'ok'), true)
  assert.equal(writeItem('chessly:big', 'x'.repeat(64)), false, 'the caller must be told to make room')
})
